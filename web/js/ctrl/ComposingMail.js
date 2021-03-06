"use strict";

tutao.provide('tutao.tutanota.ctrl.ComposingMail');

/**
 * This class represents a mail that is currently written. It contains mail, body and other editing fields.
 * @param {string} conversationType The conversationType.
 * @param {string?} previousMessageId The message id of the mail that the new mail is a reply to or that is forwarded. Null if this is a new mail.
 * @constructor
 * @implements {tutao.tutanota.ctrl.bubbleinput.BubbleHandler}
 */
tutao.tutanota.ctrl.ComposingMail = function(conversationType, previousMessageId) {
	tutao.util.FunctionUtils.bindPrototypeMethodsToThis(this);

	this.composerSubject = ko.observable("");
	this.subjectFieldFocused = ko.observable(false);
    // @type {function(tutao.tutanota.util.DataFile|tutao.entity.tutanota.File=):tutao.tutanota.util.DataFile|tutao.entity.tutanota.File=}
	this._attachments = ko.observableArray();
	this.currentlyDownloadingAttachment = ko.observable(null); // null or a DataFile

	this.toRecipientsViewModel = new tutao.tutanota.ctrl.bubbleinput.BubbleInputViewModel(this);
	this.ccRecipientsViewModel = new tutao.tutanota.ctrl.bubbleinput.BubbleInputViewModel(this);
	this.bccRecipientsViewModel = new tutao.tutanota.ctrl.bubbleinput.BubbleInputViewModel(this);

	this.secure = ko.observable(true);
	this.conversationType = conversationType;
	this.previousMessageId = previousMessageId;
	this.previousMailListColumnVisible = tutao.locator.mailView.isMailListColumnVisible();

	this.busy = ko.observable(false);
    this.busy.subscribe(function(newBusy) {
        this.toRecipientsViewModel.setEnabled(!newBusy);
        this.ccRecipientsViewModel.setEnabled(!newBusy);
        this.bccRecipientsViewModel.setEnabled(!newBusy);
    }, this);

	this.directSwitchActive = true;

	this.mailBodyLoaded = ko.observable(true);

    var self = this;
    var notBusy = function() {
        return !self.busy();
    };
	this.buttons = [
			        new tutao.tutanota.ctrl.Button("attachFiles_action", 9, this.attachSelectedFiles, notBusy, true, "composer_attach"),
			        new tutao.tutanota.ctrl.Button("send_action", 10, this.sendMail, notBusy, false, "composer_send"),
			        new tutao.tutanota.ctrl.Button("dismiss_action", 8, function () {
                        self.cancelMail(false);
                    }, notBusy, false, "composer_cancel")
			        ];
	this.buttonBarViewModel = new tutao.tutanota.ctrl.ButtonBarViewModel(this.buttons);
    this.buttonBarViewModel.init();

    tutao.locator.passwordChannelViewModel.init();
};

/**
 * The maximum attachments size for unsecure external recipients.
 */
tutao.tutanota.ctrl.ComposingMail.MAX_EXTERNAL_ATTACHMENTS_SIZE = 26214400;

/**
 * @param {string} bodyText The unsanitized body text. May be an empty string.
 */
tutao.tutanota.ctrl.ComposingMail.prototype.setBody = function(bodyText) {
    tutao.locator.mailView.setComposingBody(bodyText);
};

/**
 * Provides the information if this composing mail shall be switched away directly without sliding animation.
 * When sending this mail or canceling without another mail selected, this returns false.
 * @return {boolean} True if yes, false otherwise.
 */
tutao.tutanota.ctrl.ComposingMail.prototype.isDirectSwitchActive = function() {
	return this.directSwitchActive;
};

tutao.tutanota.ctrl.ComposingMail.prototype.showCcAndBcc = function() {
	return (this.ccRecipientsViewModel.bubbles().length > 0 || this.bccRecipientsViewModel.bubbles().length > 0 || this.ccRecipientsViewModel.inputActive() || this.bccRecipientsViewModel.inputActive());
};

tutao.tutanota.ctrl.ComposingMail.prototype.getCcFieldLabel = function() {
	return (this.showCcAndBcc()) ? tutao.locator.languageViewModel.get("cc_label") : tutao.locator.languageViewModel.get("ccBcc_label");
};

/**
 * Switches the confidentiality for this mail.
 */
tutao.tutanota.ctrl.ComposingMail.prototype.switchSecurity = function() {
	if (!this.secure() || this.containsExternalRecipients()) {
		this.secure(!this.secure());
	}
};

/**
 * Sends the new mail.
 */
tutao.tutanota.ctrl.ComposingMail.prototype.sendMail = function() {
	var self = this;
	var invalidRecipients = (this.toRecipientsViewModel.inputValue() !== "") || (this.ccRecipientsViewModel.inputValue() !== "") || (this.bccRecipientsViewModel.inputValue() !== "");
	if (!invalidRecipients && this.toRecipientsViewModel.bubbles().length === 0 && this.ccRecipientsViewModel.bubbles().length === 0 && this.bccRecipientsViewModel.bubbles().length === 0) {
		// setTimeout is needed because fastClick would call the event twice otherwise
		setTimeout(function() {
			tutao.tutanota.gui.alert(tutao.locator.languageViewModel.get("noRecipients_msg"));
		}, 0);
		return;
	}
	if (invalidRecipients) {
		setTimeout(function() {
			tutao.tutanota.gui.alert(tutao.locator.languageViewModel.get("invalidRecipients_msg"));
		}, 0);
		return;
	}
	if (this.composerSubject().length === 0) {
		setTimeout(function() {
			tutao.tutanota.gui.alert(tutao.locator.languageViewModel.get("noSubject_msg"));
		}, 0);
		return;
	}

    return this._resolveRecipients().then(function() {
        var unsecureRecipients = self._containsUnsecureRecipients();
        if (self.secure() && unsecureRecipients) {
            setTimeout(function() {
                var message = "noPasswordChannels_msg";
                if ( !tutao.locator.passwordChannelViewModel.isAutoTransmitPasswordAllowed() ){
                    message = "noPreSharedPassword_msg";
                }
                tutao.tutanota.gui.alert(tutao.locator.languageViewModel.get(message));
                tutao.locator.mailView.showPasswordChannelColumn();
            }, 0);
            return;
        }
        if (self.secure() && self._containsInvalidPhoneNumber()) {
            setTimeout(function() {
                tutao.tutanota.gui.alert(tutao.locator.languageViewModel.get("invalidPasswordChannels_msg"));
                tutao.locator.mailView.showPasswordChannelColumn();
            }, 0);
            return;
        }

        if (!self.secure()) {
            var attachmentsSize = 0;
            for (var i = 0; i < self._attachments().length; i++) {
                attachmentsSize += self._attachments()[i].getSize();
            }
            if (attachmentsSize > tutao.tutanota.ctrl.ComposingMail.MAX_EXTERNAL_ATTACHMENTS_SIZE) {
                setTimeout(function() {
                    tutao.tutanota.gui.alert(tutao.locator.languageViewModel.get("maxSizeExceeded_msg", { "$": tutao.tutanota.util.Formatter.formatFileSize(tutao.tutanota.ctrl.ComposingMail.MAX_EXTERNAL_ATTACHMENTS_SIZE) }));
                }, 0);
                return;
            }
        }

        var secureExternalRecipients = tutao.locator.passwordChannelViewModel.getSecureExternalRecipients();

        // check if a pre-shared password is not strong enough
        var onePresharedPasswordNotStrongEnough = false;
        for (var i = 0; i < secureExternalRecipients.length; i++) {
            var presharedPassword = secureExternalRecipients[i].getEditableContact().presharedPassword();
            if (presharedPassword != null && tutao.locator.passwordChannelViewModel.getPasswordStrength(secureExternalRecipients[i]) < 80) {
                onePresharedPasswordNotStrongEnough = true;
                break;
            }
        }

        if (!onePresharedPasswordNotStrongEnough || tutao.tutanota.gui.confirm(tutao.locator.languageViewModel.get("presharedPasswordNotStrongEnough_msg"))) {
            return self._updateContactInfo(self.getAllComposerRecipients()).then(function() {
                self._freeBubbles();

                var senderName = "";
                if (tutao.locator.userController.isInternalUserLoggedIn()) {
                    senderName = tutao.locator.userController.getUserGroupInfo().getName();
                }

                var facade = null;
                if (tutao.locator.userController.isExternalUserLoggedIn()) {
                    facade = tutao.tutanota.ctrl.SendMailFromExternalFacade;
                } else if (unsecureRecipients) {
                    facade = tutao.tutanota.ctrl.SendUnsecureMailFacade;
                } else {
                    facade = tutao.tutanota.ctrl.SendMailFacade;
                }

                // the mail is sent in the background
                self.busy(true);
                self.directSwitchActive = false;

                var propertyLanguage = tutao.locator.mailBoxController.getUserProperties().getNotificationMailLanguage();
                var selectedLanguage = tutao.locator.passwordChannelViewModel.getNotificationMailLanguage();
                var promise = Promise.resolve();
                if ( selectedLanguage != propertyLanguage){
                    tutao.locator.mailBoxController.getUserProperties().setNotificationMailLanguage(selectedLanguage);
                    promise = tutao.locator.mailBoxController.getUserProperties().update();
                }

                return promise.then(function () {
                    return facade.sendMail(self.composerSubject(), tutao.locator.mailView.getComposingBody(), senderName, self.getComposerRecipients(self.toRecipientsViewModel),
                        self.getComposerRecipients(self.ccRecipientsViewModel), self.getComposerRecipients(self.bccRecipientsViewModel),
                        self.conversationType, self.previousMessageId, self._attachments(), tutao.locator.passwordChannelViewModel.getNotificationMailLanguage()).then(function(senderMailElementId, exception) {
                            tutao.locator.mailView.fadeFirstMailOut();
                            setTimeout(function() {
                                tutao.locator.mailViewModel.removeFirstMailFromConversation();
                                self._restoreViewState(tutao.locator.mailViewModel.isConversationEmpty());
                                if (tutao.locator.userController.isExternalUserLoggedIn()) {
                                    // external users do not download mails automatically, so download the sent email now
                                    tutao.entity.tutanota.Mail.load([tutao.locator.mailBoxController.getUserMailBox().getMails(), senderMailElementId]).then(function(mail, exception) {
                                        tutao.locator.mailListViewModel.updateOnNewMails([mail]);
                                    });
                                }
                            }, 500);
                        });
                }).caught(tutao.RecipientsNotFoundError, function(exception) {
                    self.busy(false);
                    var notFoundRecipients = exception.getRecipients();
                    var recipientList = "";
                    for (var i = 0; i < notFoundRecipients.length; i++) {
                        recipientList += notFoundRecipients[i] + "\n";
                    }
                    tutao.tutanota.gui.alert( tutao.lang("invalidRecipients_msg") + "\n" + recipientList );
                    console.log("recipients not found", exception);
                }).lastly(function() {
                    self.busy(false);
                });

            });
        } else{
            tutao.locator.mailView.showPasswordChannelColumn();
        }
    })
};

/**
 * Try to cancel creating this new mail. The user is asked if it shall be cancelled if he has already entered text.
 * @param {boolean} directSwitch True if the cancelled mail should be hidden immediately because another mail was selected.
 * @return {boolean} True if the mail was cancelled, false otherwise.
 */
tutao.tutanota.ctrl.ComposingMail.prototype.cancelMail = function(directSwitch) {
    // if the email is currently, sent, do not cancel the email.
    if (this.busy()) {
        return false;
    }
	var body = tutao.locator.mailView.getComposingBody();
	var confirm = (this.composerSubject() !== "" ||
            (body !== "" && body !== "<br>") ||
			this.toRecipientsViewModel.inputValue() !== "" ||
			this.toRecipientsViewModel.bubbles().length != 0 ||
			this.ccRecipientsViewModel.inputValue() !== "" ||
			this.ccRecipientsViewModel.bubbles().length != 0 ||
			this.bccRecipientsViewModel.inputValue() !== "" ||
			this.bccRecipientsViewModel.bubbles().length != 0);
	if (!confirm || tutao.tutanota.gui.confirm(tutao.locator.languageViewModel.get("deleteMail_msg"))) {
		if (!directSwitch) {
			this.directSwitchActive = false;
		}

		this._freeBubbles();

		//an async animation is shown when the mail is removed. We have to wait for it.
		var self = this;
		tutao.locator.mailViewModel.removeFirstMailFromConversation();
		setTimeout(function() {
			self._restoreViewState(tutao.locator.mailViewModel.isConversationEmpty());
		}, 500);
		return true;
	} else {
		return false;
	}
};

/**
 * if no mail was selected -> show mail list column
 * if mail was selected (if showLastSelected == true) and conversation column visible -> show last mail
 * if mail was selected and mail list column visible -> show last mail, show mail list column
 * @param {boolean} showLastSelected true, if the last selected mail shall be shown.
 */
tutao.tutanota.ctrl.ComposingMail.prototype._restoreViewState = function(showLastSelected) {
	if (showLastSelected) {
		tutao.locator.mailListViewModel.selectPreviouslySelectedMail();
	}
	if (this.previousMailListColumnVisible) {
		tutao.locator.mailView.showDefaultColumns();
	}
};

/**
 * Calles deleted() on each bubble in each bubble input field to free the contained editable contact.
 */
tutao.tutanota.ctrl.ComposingMail.prototype._freeBubbles = function() {
	for (var i = 0; i < this.toRecipientsViewModel.bubbles().length; i++) {
		this.bubbleDeleted(this.toRecipientsViewModel.bubbles()[i]);
	}
	for (var i = 0; i < this.ccRecipientsViewModel.bubbles().length; i++) {
		this.bubbleDeleted(this.ccRecipientsViewModel.bubbles()[i]);
	}
	for (var i = 0; i < this.bccRecipientsViewModel.bubbles().length; i++) {
		this.bubbleDeleted(this.bccRecipientsViewModel.bubbles()[i]);
	}
};

/**
 * Returns an array of RecipientInfos from the given BubbleInputViewModel.
 * @param {tutao.tutanota.ctrl.bubbleinput.BubbleInputViewModel} recipientsViewModel The view model to get the recipients from.
 * @return {Array.<tutao.tutanota.ctrl.RecipientInfo>} The recipient infos.
 */
tutao.tutanota.ctrl.ComposingMail.prototype.getComposerRecipients = function(recipientsViewModel) {
	var r = [];
	for (var i = 0; i < recipientsViewModel.bubbles().length; i++) {
		r.push(recipientsViewModel.bubbles()[i].entity);
	}
	return r;
};

/**
 * Returns an array of RecipientInfos containing all to, cc and bcc recipientsInfos.
 * @return {Array.<tutao.tutanota.ctrl.RecipientInfo>} The recipient infos.
 */
tutao.tutanota.ctrl.ComposingMail.prototype.getAllComposerRecipients = function() {
	return this.getComposerRecipients(this.toRecipientsViewModel)
		.concat(this.getComposerRecipients(this.ccRecipientsViewModel))
		.concat(this.getComposerRecipients(this.bccRecipientsViewModel));
};

/**
 * Add a recipient to the "to" recipients.
 * @param {tutao.tutanota.ctrl.RecipientInfo} recipientInfo The recipient info.
 */
tutao.tutanota.ctrl.ComposingMail.prototype.addToRecipient = function(recipientInfo) {
	this.toRecipientsViewModel.addBubble(this._createBubbleFromRecipientInfo(recipientInfo));
};

/**
 * Add a recipient to the "cc" recipients.
 * @param {tutao.tutanota.ctrl.RecipientInfo} recipientInfo The recipient info.
 */
tutao.tutanota.ctrl.ComposingMail.prototype.addCcRecipient = function(recipientInfo) {
	this.ccRecipientsViewModel.addBubble(this._createBubbleFromRecipientInfo(recipientInfo));
};

/**
 * Returns if there are unsecure recipients among the current recipients.
 * @return {boolean} True if there are unsecure recipients among the given recipients, false otherwise.
 */
tutao.tutanota.ctrl.ComposingMail.prototype._containsUnsecureRecipients = function() {
	if (!this.secure()) {
		return true;
	}
	var r = this.getAllComposerRecipients();
	for (var i = 0; i < r.length; i++) {
		if (!r[i].isSecure()) {
			return true;
		}
	}
	return false;
};

/**
 * Tries to resolve unknown recipients if there are any
 * @return {Promise.<>} Resolves, if all unknown recipients have been resolved.
 */
tutao.tutanota.ctrl.ComposingMail.prototype._resolveRecipients = function() {
    return Promise.each(this.getAllComposerRecipients(), function(/* tutao.tutanota.ctrl.RecipientInfo */recipientInfo) {
        return recipientInfo.resolveType();
    });
};

tutao.tutanota.ctrl.ComposingMail.prototype._containsInvalidPhoneNumber = function() {
	if (!this.secure()) {
		return false;
	}
	var r = this.getAllComposerRecipients();
	for (var i = 0; i < r.length; i++) {
		if (tutao.locator.passwordChannelViewModel.containsInvalidNotSavedNumbers(r[i])) {
			return true;
		}
	}
	return false;
};

/**
 * Returns true if this mail shall (also) be sent to external recipients in a secure way. Returns false if not yet known for some recipients.
 * @return {boolean}
 */
tutao.tutanota.ctrl.ComposingMail.prototype.composeForSecureExternalRecipients = function() {
	if (this.secure()) {
		return this.containsExternalRecipients();
	} else {
		return false;
	}
};


/**
 * Returns true if this mail contains external recipients.
 * @return {boolean}
 */
tutao.tutanota.ctrl.ComposingMail.prototype.containsExternalRecipients = function() {
	var r = this.getAllComposerRecipients();
	for (var i = 0; i < r.length; i++) {
		if (r[i].isExternal()) {
			return true;
		}
	}
	return false;
};

/**
 * Offers the user to download the given data file which was added to this mail.
 * @param {tutao.tutanota.util.DataFile} dataFile The file to download.
 */
tutao.tutanota.ctrl.ComposingMail.prototype.downloadNewAttachment = function(dataFile) {
    if (this.busy()) {
        return;
    }
	var self = this;
	// do not allow a new download as long as another is running
	if (this.currentlyDownloadingAttachment()) {
		return;
	}
	this.currentlyDownloadingAttachment(dataFile);
	tutao.tutanota.util.FileUtils.provideDownload(dataFile).then(function() {
		self.currentlyDownloadingAttachment(null);
	});
};

/**
 * Removes the given data file from the attachments.
 * @param {tutao.tutanota.util.DataFile} dataFile The file to remove.
 */
tutao.tutanota.ctrl.ComposingMail.prototype.removeAttachment = function(dataFile) {
    if (this.busy()) {
        return;
    }
	this._attachments.remove(dataFile);
};

/**
 * Called when local files are dragged across the composed mail.
 * @param {tutao.tutanota.ctrl.ComposingMail} data The mail.
 * @param {Event} e The event.
 */
tutao.tutanota.ctrl.ComposingMail.prototype.handleDragOver = function(data, e) {
    if (this.busy()) {
        return;
    }
    e.originalEvent.stopPropagation();
    e.originalEvent.preventDefault();
    e.originalEvent.dataTransfer.dropEffect = 'copy';
};

/**
 * Called when local files are dropped onto the composed mail.
 * @param {tutao.tutanota.ctrl.ComposingMail} data The mail.
 * @param {Event} e The event.
 */
tutao.tutanota.ctrl.ComposingMail.prototype.attachDroppedFiles = function(data, e) {
    if (this.busy()) {
        return;
    }
    e.originalEvent.stopPropagation();
    e.originalEvent.preventDefault();
    this.attachFiles(e.originalEvent.dataTransfer.files);
};

/**
 * Called when the user shall choose a file from the file system.
 */
tutao.tutanota.ctrl.ComposingMail.prototype.attachSelectedFiles = function() {
	var self = this;
	tutao.tutanota.util.FileUtils.showFileChooser().then(function(fileList) {
		self.attachFiles(fileList);
	});
};

/**
 * Attaches the files in the given FileList.
 * @param {FileList} fileList The files to attach.
 */
tutao.tutanota.ctrl.ComposingMail.prototype.attachFiles = function(fileList) {
	var tooBigFiles = [];
	var self = this;
	for (var i = 0; i < fileList.length; i++) {
		if (fileList[i].size > tutao.entity.tutanota.TutanotaConstants.MAX_ATTACHMENT_SIZE) {
			tooBigFiles.push(fileList[i].name);
		} else {
			tutao.tutanota.util.FileUtils.readLocalFile(fileList[i]).then(function(dataFile, exception) {
				self._attachments.push(dataFile);
			}).caught(function(exception) {
                tutao.tutanota.gui.alert(tutao.lang("couldNotAttachFile_msg"));
                console.log(exception);
            });
		}
	}
	if (tooBigFiles.length > 0) {
		tutao.tutanota.gui.alert(tutao.locator.languageViewModel.get("tooBigAttachment_msg") + tooBigFiles.join(", "));
	}
};

/**
 * Provides the image that shall be shown in the attachment.
 * @param {tutao.tutanota.util.DataFile} dataFile The file.
 * @return {String} The name of the image.
 */
tutao.tutanota.ctrl.ComposingMail.prototype.getAttachmentImage = function(dataFile) {
	var busy = (dataFile == this.currentlyDownloadingAttachment());
	return tutao.tutanota.util.FileUtils.getFileTypeImage(dataFile.getName(), busy);
};

/************** implementation of tutao.tutanota.ctrl.bubbleinput.BubbleHandler **************/

/** @inheritDoc */
tutao.tutanota.ctrl.ComposingMail.prototype.getSuggestions = function(text) {
	text = text.trim().toLowerCase();
	var contactWrappers = tutao.tutanota.ctrl.ComposingMail._getContacts();
	var sugs = [];
	if (text === "") { // do not display any suggestions when nothing has been entered
		return sugs;
	}
	for (var i = 0; i < contactWrappers.length; i++) {
		var contact = contactWrappers[i].getContact();
		var addAllMailAddresses = (text == "" ||
				tutao.util.StringUtils.startsWith(contact.getFirstName().toLowerCase(), text) ||
				tutao.util.StringUtils.startsWith(contact.getLastName().toLowerCase(), text) ||
				tutao.util.StringUtils.startsWith(contactWrappers[i].getFullName().toLowerCase(), text));
		for (var a = 0; a < contact.getMailAddresses().length; a++) {
			var mailAddress = contact.getMailAddresses()[a].getAddress().toLowerCase();
			if (addAllMailAddresses || tutao.util.StringUtils.startsWith(mailAddress, text)) {
				var suggestionText = contactWrappers[i].getFullName() + " <" + mailAddress + ">";
				sugs.push(new tutao.tutanota.ctrl.bubbleinput.Suggestion({ contactWrapper: contactWrappers[i], mailAddress: mailAddress }, suggestionText));
			}
		}
	}
	return sugs;
};

/** @inheritDoc */
tutao.tutanota.ctrl.ComposingMail.prototype.createBubbleFromSuggestion = function(suggestion) {
	var recipientInfo = new tutao.tutanota.ctrl.RecipientInfo(suggestion.id.mailAddress, suggestion.id.contactWrapper.getFullName(), suggestion.id.contactWrapper);
    recipientInfo.resolveType().caught(tutao.ConnectionError, function(e) {
        // we are offline but we want to show the dialog only when we click on send.
    });
	return this._createBubbleFromRecipientInfo(recipientInfo);
};

/** @inheritDoc */
tutao.tutanota.ctrl.ComposingMail.prototype.createBubblesFromText = function(text) {
    var bubbles = [];
    var separator = (text.indexOf(";") != -1) ? ";" : ",";
    var textParts = text.split(separator);
    for (var i=0; i<textParts.length; i++) {
        var part = textParts[i].trim();
        if (part.length == 0) {
            continue;
        }
        var recipientInfo = this.getRecipientInfoFromText(part);
        recipientInfo.resolveType().caught(tutao.ConnectionError, function(e) {
            // we are offline but we want to show the dialog only when we click on send.
        });
        if (!recipientInfo) {
            // if one recipient is invalid, we do not return any valid ones because all invalid text would be deleted
            return [];
        }
        bubbles.push(this._createBubbleFromRecipientInfo(recipientInfo));
    }
	return bubbles;
};

/**
 * Creates a bubble from a recipient info.
 * @param {tutao.tutanota.ctrl.RecipientInfo} recipientInfo The recipientInfo.
 * @return {tutao.tutanota.ctrl.bubbleinput.Bubble} The bubble.
 */
tutao.tutanota.ctrl.ComposingMail.prototype._createBubbleFromRecipientInfo = function(recipientInfo) {
    var state = ko.computed(function() {
        if (recipientInfo.getRecipientType() == tutao.tutanota.ctrl.RecipientInfo.TYPE_UNKNOWN) {
            return "unknownRecipient";
        } else if (this.secure() || recipientInfo.getRecipientType() == tutao.tutanota.ctrl.RecipientInfo.TYPE_INTERNAL) {
            return "secureRecipient";
        } else {
            return "unsecureRecipient";
        }
    }, this);
	return new tutao.tutanota.ctrl.bubbleinput.Bubble(recipientInfo, ko.observable(recipientInfo.getDisplayText()), ko.observable(recipientInfo.getMailAddress()), state, true);
};

/**
 * Retrieves a RecipientInfo instance from a text. The text may be a contact name, contact mail address or other mail address.
 * @param {string} text The text to create a RecipientInfo from.
 * @return {tutao.tutanota.ctrl.RecipientInfo} The recipient info or null if the text is not valid data.
 */
tutao.tutanota.ctrl.ComposingMail.prototype.getRecipientInfoFromText = function(text) {
	text = text.trim();
	if (text == "") {
		return null;
	}
	var nameAndMailAddress = tutao.tutanota.util.Formatter.stringToNameAndMailAddress(text);

	var contactWrappers = tutao.tutanota.ctrl.ComposingMail._getContacts();
	for (var i = 0; i < contactWrappers.length; i++) {
		if (nameAndMailAddress) {
			if (contactWrappers[i].hasMailAddress(nameAndMailAddress.mailAddress)) {
				var name = (nameAndMailAddress.name != "") ? nameAndMailAddress.name : contactWrappers[i].getFullName();
                return new tutao.tutanota.ctrl.RecipientInfo(nameAndMailAddress.mailAddress, name, contactWrappers[i]);
			}
		} else {
			if (contactWrappers[i].getFullName() == text && contactWrappers[i].getContact().getMailAddresses().length == 1) {
                return new tutao.tutanota.ctrl.RecipientInfo(contactWrappers[i].getContact().getMailAddresses()[0].getAddress(), text, contactWrappers[i]);
			}
		}
	}
	if (!nameAndMailAddress) {
		return null;
	} else {
        return new tutao.tutanota.ctrl.RecipientInfo(nameAndMailAddress.mailAddress, nameAndMailAddress.name, null);
	}
};

/**
 * Provides all contacts of the logged in user.
 * @return {Array.<tutao.entity.tutanota.ContactWrapper>} All contacts of the logged in user.
 */
tutao.tutanota.ctrl.ComposingMail._getContacts = function() {
	return tutao.locator.contactListViewModel.getRawContacts();
};

/** @inheritDoc */
tutao.tutanota.ctrl.ComposingMail.prototype.bubbleDeleted = function(bubble) {
	// notify the recipient info to stop editing the contact
	bubble.entity.setDeleted();
};

/** @inheritDoc */
tutao.tutanota.ctrl.ComposingMail.prototype.buttonClick = function() {
	// we do not show a button
};

/** @inheritDoc */
tutao.tutanota.ctrl.ComposingMail.prototype.buttonCss = function() {
	// we do not show a button
	return null;
};


/**
 * Updates the contact informations of all recipients if they have been modified.
 * @param {Array.<tutao.tutanota.ctrl.RecipientInfo>} recipients List of recipients.
 * @private
 * @return {Promise} Resolves when all contacts have been updated
 */
tutao.tutanota.ctrl.ComposingMail.prototype._updateContactInfo = function (recipients) {
    return Promise.each(recipients, function(/*tutao.tutanota.ctrl.RecipientInfo*/currentRecipient) {
        // Changes of contact data must be checked before calling EditableContact.update(),
        var contactDataChanged = currentRecipient.hasPasswordChanged() || currentRecipient.hasPhoneNumberChanged();
        currentRecipient.getEditableContact().update();
        if (currentRecipient.isExistingContact()) {
            //only update if phone numbers or passwords have changed
            if ( contactDataChanged ){
                return currentRecipient.getEditableContact().getContact().update();
            }
        } else {
            // external users have no contact list.
            if (tutao.locator.mailBoxController.getUserContactList() != null) {
                return currentRecipient.getEditableContact().getContact().setup(tutao.locator.mailBoxController.getUserContactList().getContacts());
            }
        }
    })
};



