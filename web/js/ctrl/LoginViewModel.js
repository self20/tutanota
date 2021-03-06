"use strict";

tutao.provide('tutao.tutanota.ctrl.LoginViewModel');

/**
 * The ViewModel for the Login template.
 * @constructor
 */
tutao.tutanota.ctrl.LoginViewModel = function() {
	tutao.util.FunctionUtils.bindPrototypeMethodsToThis(this);

	this.welcomeTextId = ko.observable("welcome_msg");
	this.welcomeText = ko.computed(function() {
		return tutao.locator.languageViewModel.get(this.welcomeTextId());
	}, this, {deferEvaluation: true});

	this.mailAddress = ko.observable("");
	var address = tutao.tutanota.util.LocalStore.load('userMailAddress');
	if (address) {
		this.mailAddress(address);
	}
	this.mailAddressFieldFocused = ko.observable(false);
	this.passphrase = ko.observable("");
	this.passphraseFieldFocused = ko.observable(false);

	var emptyString = "\u2008"; // an empty string or normal whitespace makes the label collapse, so enter this invisible character
	this.loginStatus = ko.observable({ type: "neutral", text: "emptyString_msg" });
	this.loginOngoing = ko.observable(false);

	this.mailAddress.subscribe(function(newValue) {
	    this.loginStatus({ type: "neutral", text: "emptyString_msg" });
	}, this);
	this.passphrase.subscribe(function(newValue) {
	    this.loginStatus({ type: "neutral", text: "emptyString_msg" });
	}, this);
	
	this.loginPossible = ko.computed(function() {
		return (!this.loginOngoing());
	}, this);
};

/**
 * Sets the focus when the view is shown.
 */
tutao.tutanota.ctrl.LoginViewModel.prototype.activate = function() {
	var self = this;
	setTimeout(function() {
		if (self.mailAddress() == "") {
			self.mailAddressFieldFocused(true);
		} else {
			self.passphraseFieldFocused(true);
		}
	}, 0);
};

/**
 * Sets the given mail address as login mail address.
 * @param {string} mailAddress The mail address.
 */
tutao.tutanota.ctrl.LoginViewModel.prototype.setMailAddress = function(mailAddress) {
	this.mailAddress(mailAddress);
};

/**
 * Sets the id of the welcome text that shall be shown (see tutao.tutanota.ctrl.LanguageViewModel).
 * @param {string} id The id of the welcome text.
 */
tutao.tutanota.ctrl.LoginViewModel.prototype.setWelcomeTextId = function(id) {
	this.welcomeTextId(id);
};

/**
 * Logs a user into the system:
 * <ul>
 *   <li>Sets the logged in user on the UserController
 *   <li>Initializes the DBFacade for the user
 *   <li>Switches to the MailView
 * </ul>
 * @return {Promise.<>} Resolves when finished, rejected if failed.
 */
tutao.tutanota.ctrl.LoginViewModel.prototype.login = function() {
	var self = this;
	if (!this.loginPossible()) {
		return;
	}
	this.loginOngoing(true);
	// in private browsing mode in mobile safari local storage is not available and throws an exception
	this.passphraseFieldFocused(false);
	tutao.tutanota.util.LocalStore.store('userMailAddress', this.mailAddress());
	return tutao.locator.userController.loginUser(self.mailAddress(), self.passphrase()).then(function () {
        self.passphrase("");
    }).then(function() {
        return self.postLoginActions();
    }).caught(tutao.AccessBlockedError, function() {
        self.loginStatus({ type: "invalid", text: "loginFailedOften_msg" });
    }).caught(tutao.NotAuthenticatedError, function(exception) {
        self.loginStatus({ type: "invalid", text: "loginFailed_msg" });
    }).caught(tutao.AccessDeactivatedError, function() {
        self.loginStatus({ type: "invalid", text: "loginFailed_msg" });
    }).lastly(function() {
        self.loginOngoing(false);
    });
};

tutao.tutanota.ctrl.LoginViewModel.prototype.postLoginActions = function () {
    var self = this;
    return tutao.locator.mailBoxController.initForUser().then(function() {
        // this should be the user id instead of the name later
        return new Promise(function(resolve, reject) {
            tutao.locator.dao.init("Tutanota_" + self.mailAddress(), resolve);
        });
    }).then(function () {
        return self.loadEntropy();
    }).then(function() {
        // load all contacts to have them available in cache, e.g. for RecipientInfos
        return tutao.locator.contactListViewModel.init();
    }).then(function() {
        tutao.locator.eventBus.connect(false);
        tutao.locator.navigator.mail();
    });
};

/**
 * Loads entropy from the last logout. Fetches missing entropy if none was stored yet and stores it.
 * @return {Promise.<>} Resolves when finished, rejected if failed.
 */
tutao.tutanota.ctrl.LoginViewModel.prototype.loadEntropy = function() {
    var self = this;
    return new Promise(function(resolve, reject) {
        try  {
            var groupEncEntropy = tutao.locator.mailBoxController.getUserProperties().getGroupEncEntropy();
            if (!groupEncEntropy) {
                tutao.locator.entropyCollector.fetchMissingEntropy(function() {
                    self.storeEntropy();
                    resolve();
                });
            } else {
                var entropy = tutao.locator.aesCrypter.decryptBytes(tutao.locator.userController.getUserGroupKey(), groupEncEntropy);
                tutao.locator.entropyCollector.addStaticEntropy(entropy);
                resolve();
            }
        } catch (exception) {
            reject(exception);
        }
    });
};

/**
 * Stores entropy from the randomizer for the next login.
 */
tutao.tutanota.ctrl.LoginViewModel.prototype.storeEntropy = function() {
    var groupEncEntropy = tutao.locator.aesCrypter.encryptBytes(tutao.locator.userController.getUserGroupKey(), tutao.util.EncodingConverter.hexToBase64(tutao.locator.randomizer.generateRandomData(32)));
    tutao.locator.mailBoxController.getUserProperties().setGroupEncEntropy(groupEncEntropy);
    tutao.locator.mailBoxController.getUserProperties().update();
};

tutao.tutanota.ctrl.LoginViewModel.prototype.createAccount = function() {
    tutao.locator.navigator.register();
};