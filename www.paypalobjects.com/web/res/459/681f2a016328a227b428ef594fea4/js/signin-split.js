// jscs:disable validateIndentation
window.PAYPAL = window.PAYPAL || {};
(function() {
'use strict';
var login = {};
// LOG user activity to FPTI & CAL
login.logger = (function() {
	var logData = [];

	function log(logEntry) {
		logEntry.timestamp = Date.now ? Date.now() : (new Date()).getTime();
		logData.push(logEntry);
	}

	function pushLogs(options) {
		var csrfToken, csrfTokenValue;
		var intent = login.utils.getIntent();
		var flowId = login.utils.getFlowId();
		var liteExp = $('body').data('loginLiteExperience');
		var data;

		if (logData.length === 0) {
			return;
		}

		options = options || {};

		logData.push({
			evt: 'context_correlation_id',
			data: $('body').data('correlationId'),
			instrument: true
		});

		// Add context to the logs
		if (intent) {
			logData.push({
				evt: 'serverside_data_source',
				data: intent,
				instrument: true
			});

			logData.push({
				evt: 'intent',
				data: intent,
				instrument: true
			});
		}

		if (flowId) {
			logData.push({
				evt: 'context_id',
				data: flowId,
				instrument: true
			});
		}

		if (liteExp) {
			logData.push({
				evt: 'lite_experience',
				data: 'Y',
				instrument: true
			});
		}

		csrfToken = document.querySelector('#token') || document.querySelector('input[name="_csrf"]');
		csrfTokenValue = csrfToken && csrfToken.value;

		// Default data values
		data = {
			_csrf: csrfTokenValue,
			currentUrl: window.location.href,
			logRecords: JSON.stringify(logData),
			intent: intent
		};

		if (typeof options.data === 'object') {
			Object.assign(data, options.data);
		}

		$.ajax({
			url: '/signin/client-log',
			data: data,
			success: options.success,
			fail: options.fail,
			complete: options.complete
		});
		logData = [];
	}

	/**
	 * Wrapper method for logging client side with the consolidated list of events
	 *
	 * @param {Array} logList
	 * @param {Function} callback
	 * @param {Object?} data
	 */
	function clientLog(logList, callback, data) {
		logList = logList || [];

		if (!(logList instanceof Array)) {
			if (typeof callback === 'function') {
				return callback();
			}
			return;
		}

		for (var i = 0; i < logList.length; i++) {
			log(logList[i]);
		}

		var logPayload = {
			complete: function() {
				if (typeof callback === 'function') {
					return callback();
				}
			}
		};

		if (typeof data === 'object') {
			logPayload.data = data;
		}

		pushLogs(logPayload);
	}

	function getStateName() {
		var splitLoginContext = login.utils.getSplitLoginContext();
		var isHybrid = login.utils.isHybridLoginExperience();
		var kmliCb = document.getElementById('keepMeLoggedIn');
		var stateName = kmliCb ? 'LOGIN_UL_RM' : 'LOGIN_UL';
		var splitLoginMap = {
			inputEmail: 'begin_email',
			implicitEmail: 'begin_email',
			inputPassword: isHybrid ? 'begin_hybrid_pwd' : 'begin_pwd',
			inputPhone: 'begin_phone'
		};
		if (splitLoginContext && splitLoginMap[splitLoginContext]) {
			stateName = splitLoginMap[splitLoginContext];
		}
		if (isHybrid && splitLoginContext !== 'inputPassword') {
			stateName = 'begin_hybrid_login';
		}
		return stateName;
	}

	function logServerPreparedMetrics() {
		var parsedClientLogRecords;
		var clientLogRecords = document.querySelector('input[name="clientLogRecords"]');

		if (clientLogRecords) {
			try {
				parsedClientLogRecords = JSON.parse(clientLogRecords.value);
			} catch (e) {}
		}
		if (parsedClientLogRecords) {
			logData = logData.concat(parsedClientLogRecords);
		}
	}

	return {
		log: log,
		logServerPreparedMetrics: logServerPreparedMetrics,
		pushLogs: pushLogs,
		clientLog: clientLog,
		getStateName: getStateName
	};
}());

// Publish/Subscriber pattern
// NOTE: this is a simplified version of pub/sub pattern which does not include unsubscribe method.
// Since unsubscribe is not present, the concept of token is not necesary
login.pubsub = (function() {
	var pubsub = {};
	var topics = {};

	// Publish or broadcast events of interest
	// with a specific topic name and arguments
	// such as the data to pass along
	pubsub.publish = function(topic, arg) {
		if (!topics[topic]) {
			return false;
		}

		var subscribers = topics[topic],
			len = subscribers ? subscribers.length : 0;

		while (len > 0) {
			subscribers[len - 1].func(arg);
			len -= 1;
		}
	};

	// Subscribe to events of interest
	// with a specific topic name and a
	// callback function, to be executed
	// when the topic/event is observed
	pubsub.subscribe = function(topic, func) {
		// only subscribe functions
		if (typeof func !== 'function') {
			return;
		}

		if (!topics[topic]) {
			topics[topic] = [];
		}

		topics[topic].push({
			func: func
		});
	};

	return pubsub;
}());

login.store = (function() {
	return function storeFactory(initialState) {

		var _state = initialState || {};

		function getState() {
			return _state;
		}

		function updateModel(model) {
			// custom validations (TODO: work on getting this logic on reducer functions)
			var splitLoginContextDom = document.querySelector('input[name=splitLoginContext]');
			if (!model.splitLoginContext) {
				model.splitLoginContext = splitLoginContextDom && splitLoginContextDom.value;
			}

			var newModel = Object.assign({}, _state.model, model);
			// State properties that should be reset on every state update
			// if new state does not provide any value
			newModel.notifications = model.notifications;
			newModel.tpdVariant = model.tpdVariant;
			newModel.showSpinnerUpfront = model.showSpinnerUpfront;
			newModel.enableSmartlock = model.enableSmartlock;
			newModel.tpdAutoSend = model.tpdAutoSend;
			newModel.webAuthnLoginContext = model.webAuthnLoginContext;

			var newState = Object.assign({}, _state, {
				model: newModel
			});
			_state = newState;
			login.pubsub.publish('STATE_UPDATED', newState);
		}

		return {
			updateModel: updateModel,
			getState: getState
		};
	}

}());

// Utils & Globals

/**
 * Global, cross browser add event listener function
 */
var addEvent = function(element, event, callback) {
	if (!element || !event || !callback) {
		return;
	}

	if (element.addEventListener) {
		element.addEventListener(event, callback, false);
	} else if (element.attachEvent) {
		element.attachEvent('on' + event, callback);
	}
};

var removeEvent = function(element, event, callback) {
	if (!element || !event || !callback) {
		return;
	}

	if (element.removeEventListener) {
		element.removeEventListener(event, callback, false);
	} else if (element.attachEvent) {
		element.detachEvent('on' + event, callback);
	}
};

/**
 * Global, cross browser create event function
 */
var createNewEvent = function(eventStr) {
	// Try modern way to construct event first and return early if created
	if (typeof window.Event === 'function') {
		return new Event(eventStr);
	}
	// As IE doesnt support the constructor to create Event,
	// we have to use an old fashion way of creating event which is deprecated
	var event = document.createEvent('Event');
	event.initEvent(eventStr, true, true);
	return event;
};

/**
 * Global, cross browser add event prevent default function
 */
var eventPreventDefault = function(event) {
	// IE compatibility
	var evt = event || window.event || {};
	if (evt.preventDefault) {
		evt.preventDefault();
	} else {
		evt.returnValue = false;
	}
};

/**
 * Global, cross browser add event stop propagation default function
 */
var eventStopPropagation = function(event) {
	// IE compatibility
	var evt = event || window.event || {};
	if (evt.stopPropagation) {
		evt.stopPropagation();
	} else {
		evt.cancelBubble = true;
	}
};

/**
 * Global, cross browser get event target function
 */
var getEventTarget = function(event) {
	// IE compatibility
	var evt = event || window.event || {};
	return evt.target || evt.srcElement;
};

/**
 * Global, cross browser to dispatch event to a target
 */
var triggerEvent = function(element, eventName) {
	if (!element || !eventName) {
		return;
	}
	var eventTrigger = createNewEvent(eventName);
	if (element.dispatchEvent) {
		element.dispatchEvent(eventTrigger);
	} else if (element.fireEvent) {
		element.fireEvent('on' + eventName, eventTrigger);
	}
};

/**
 * Global, cross browser check for Enter key pressed in event
 */
var isEnterKeyPressed = function(event) {
	// Gracefully failing
	if (!event) {
		return false;
	}

	if (event.key) {
		return event.key === 'Enter';
	} else if (event.which) {
		return event.which === 13;
	} else {
		return event.keyCode === 13
	}
};

login.utils = (function() {
	var transitioningDiv = document.querySelector('.transitioning');
	var lockIcon = document.querySelector('.lockIcon');
	var transitioningMsg = document.querySelector('.transitioning p.checkingInfo');

	function showSpinner(options) {
		if (transitioningDiv) {
			if (options && options.qrCodeSpinner) {
				$(transitioningDiv).addClass('qrcSpinner');
			} else {
				$(transitioningDiv).addClass('spinner');
			}
			if (options && options.nonTransparentMask) {
 				$(transitioningDiv).addClass('nonTransparentMask');
 			}
			$(transitioningDiv).removeClass('hide');
			transitioningDiv.setAttribute('aria-busy', 'true');
		}

		if (lockIcon) {
			$(lockIcon).removeClass('hide');
		}
	}

	function hideSpinner() {
		if (transitioningDiv) {
			$(transitioningDiv).removeClass('spinner');
			$(transitioningDiv).removeClass('nonTransparentMask');
			$(transitioningDiv).removeClass('qrcSpinner');
			$(transitioningDiv).addClass('hide');
			transitioningDiv.setAttribute('aria-busy', 'false');
		}

		if (lockIcon) {
			$(lockIcon).addClass('hide');
		}
	}

	function showSpinnerMessage(type) {
		var transitioningMsgType;
		if (type !== '') {
			transitioningMsgType = document.querySelector('.transitioning p.' + type);
			if (transitioningMsgType) {
				$(transitioningMsgType).removeClass('hide');
			}
			return;
		}
		$(transitioningMsg).removeClass('hide');
	}

	function hideSpinnerMessage(type) {
		var transitioningMsgType;
		if (type !== '') {
			transitioningMsgType = document.querySelector('.transitioning p.' + type);
			if (transitioningMsgType) {
				$(transitioningMsgType).addClass('hide');
			}
			return;
		}
		$(transitioningMsg).addClass('hide');
	}

	function isHybridLoginExperience() {
		return $('body').data('isHybridLoginExperience') === 'true';
	}

	function isHybridEditableOnCookied() {
		return $('body').data('isHybridEditableOnCookied') === 'true';
	}

	/**
	 * Special function to hijack outbound links such as footer links such that
	 * the exiting requesting can be logged and tracked via server side FPTI
	 * Once the log is pushed for tracking, the request to exit the page is resumed
	 * @param {String} link The A tag with the href and the text node in it
	 * @param {String} stateName name
	 * @param {String} transitionName
	 * @param {Function} callback Optional function that needs to be executed just before redirecting
	 */
	function getOutboundLinksHandler(link, stateName, transitionName, callback) {
		var href = link && link.getAttribute('href');
		var linkId = link && link.getAttribute('id');
		var currentLang, changeToLang, logPayload;

		return function(e) {
			e.preventDefault();
			login.logger.log({
				evt: 'state_name',
				data: stateName || login.logger.getStateName(),
				instrument: true
			});

			login.logger.log({
				evt: 'transition_name',
				data: transitionName,
				instrument: true
			});

			currentLang = document.querySelector('input[name="locale.x"]');
			if (currentLang) {
				login.logger.log({
					evt: 'page_lang',
					data: currentLang.value,
					instrument: true
				});
			}

			changeToLang = $(link).data('locale');
			if (changeToLang) {
				login.logger.log({
					evt: 'change_to_lang',
					data: changeToLang,
					instrument: true
				});
			}

			logPayload = {
				complete: function() {
					if (typeof callback === 'function') {
						return callback();
					}
					window.location = href;
				}
			};

			login.logger.pushLogs(logPayload);
			showSpinner();
		};
	}

	function switchToEmailHandler(event, callback) {
		eventPreventDefault(event);
		var emailField = document.querySelector('#email');
		var emailLabel = document.querySelector('label[for="email"]');
		emailField && $(emailField).attr('placeholder', $('body').data('emailLabel'));
		if (emailLabel) {
			$(emailLabel).text($('body').data('emailLabel'));
		}
		emailField && $(emailField).attr('data-hybrid-in-email-only-mode', true);
		var initialSplitLoginContext = document.querySelector('#initialSplitLoginContext');
		var data = {
			'_csrf': document.querySelector('#token').value,
			notYou: true,
			intent: getIntent(),
			context_id: getFlowId(),
			switchToEmail: true
		};

		if (initialSplitLoginContext) {
			data.initialSplitLoginContext = initialSplitLoginContext.value;
		}

		// Remove WebAuthn context if any (if it doesnt exist, `removeAttribute` will just return `undefined`
		document.body.removeAttribute('data-web-authn-login-context');

		$.ajax({
			type: 'POST',
			url: '/signin/not-you',
			data: data,
			dataType: 'json',
			success: successfulXhrHandler,
			fail: failedXhrSubmitHandler,
			complete: function() {
				if (typeof callback === 'function') {
					return callback();
				}
			}
		});
	}
	function notYouClickHandler(event, callback) {
		eventPreventDefault(event);
		notYouXhrCall(successfulXhrHandler, failedXhrSubmitHandler, callback);
	}

	function notYouClickHandlerForCookiedUser(event, callback) {
		eventPreventDefault(event);
		notYouXhrCall(function() {
			window.location.href = window.location.href;
		}, failedXhrSubmitHandler, callback);
	}

	function notYouXhrCall(successCb, failedCb, completeCb) {
		var initialSplitLoginContext = document.querySelector('#initialSplitLoginContext');
		var data = {
			'_csrf': document.querySelector('#token').value,
			notYou: true,
			intent: getIntent(),
			context_id: getFlowId()
		};
		if (initialSplitLoginContext) {
			data.initialSplitLoginContext = initialSplitLoginContext.value;
		}
		// Remove WebAuthn context if any (if it doesnt exist, `removeAttribute` will just return `undefined`
		document.body.removeAttribute('data-web-authn-login-context');
		$.ajax({
			type: 'POST',
			url: '/signin/not-you',
			data: data,
			dataType: 'json',
			success: successCb,
			fail: failedCb,
			complete: function() {
				if (typeof completeCb === 'function') {
					return completeCb();
				}
			}
		});
	}

	/**
	 * Returns regex pattern for matching whitespace.
	 */
	function getEmptyPattern() {
		return /^\s+|\s+$/;
	}

	/**
	 * Returns regex pattern for matching email.
	 */
	function getEmailPattern() {
		return /^\S+@\S+\.\S+$/;
	}

	/**
	 * Returns regex pattern for matching invalid characters.
	 */
	function getInvalidUserIdPattern() {
		return /\s/g;
	}

	/**
	 * Makes XHR submission of email
	 */
	function submitPublicCredential(email) {
		var isValidInput;
		var loginForm = document.querySelector('form[name=login]');
		var emailField = document.querySelector('#email');
		var inputs = document.querySelectorAll('form[name=login] input') || [];
		var formData = {};

		if (!email || !emailField) {
			return;
		}

		isValidInput = !email.match(getInvalidUserIdPattern());

		if (isValidInput) {
			email = email.replace(getEmptyPattern(), '');
			isValidInput = email.match(getEmailPattern());
		}

		if (!isValidInput) {
			return;
		}

		for (var i = 0; i < inputs.length; i++) {
			formData[inputs[i].name] = inputs[i].value;
		}

		if (email) {
			// setting emailField here because this value is used in subsequent xhr calls when on the password page.
			emailField.value = email;
			formData.login_email = email;
			formData.splitLoginContext = 'inputEmail';
			delete formData.login_phone;
			delete formData.phoneCode;
		}

		delete formData.login_password;
		delete formData.login_pin;

		$.ajax({
			url: loginForm.getAttribute('action'),
			data: formData,
			success: login.utils.successfulXhrHandler,
			fail: login.utils.failedXhrSubmitHandler
		});
	}

	function updateView(model) {
		if (login.storeInstance) {
			login.storeInstance.updateModel(model);
		}

		if (model.ulSync) {
			login.fn.updateFnSyncContext(model.ulSync);
		}

		if (!model.showSpinnerUpfront && model.smartlockStatus !== 'linked') {
			hideSpinner();
		}
	}

	function updateOnboardingButton() {
		var startOnboardingFlowWithoutForcedSignup = document.querySelector('.onboardingFlowContentKey');
		var startGuestOnboardingFlowWithoutForcedSignup = document.querySelector('.pwdContentKey');
		var pwdContentKeyExists = $('body').data('pwdContentKeyExists');

		if(pwdContentKeyExists) {
			startGuestOnboardingFlowWithoutForcedSignup && $(startGuestOnboardingFlowWithoutForcedSignup).removeClass('hide');
			startOnboardingFlowWithoutForcedSignup && $(startOnboardingFlowWithoutForcedSignup).addClass('hide');
		}
	}

	/**
	 * Handle the successful XHR submission of email (or phone)
	 */
	function successfulXhrHandler(response) {
		var ctxId = document.querySelector('input[name="ctxId"]');
		var loginForm = document.querySelector('form[name=login]');
		var headerText = $('#headerText');
		var newUserContainer = $('#newUserContainer');
		var signupContainer = $('#signupContainer');

		var onboardingFlowSection = document.querySelector('#main section[id="onboardingFlow"]');
		var otpLoginSection = document.querySelector('#main section[id="otpLogin"]');
		var verifyOtpSection = document.querySelector('#main section[id="verifyOtp"]');
		var startOnboardingFlow = $('.startOnboardingFlow');

		// Show Onboarding button based on pwdContentKey flag in email pwd page
		updateOnboardingButton();
		// remove onboarding flow if its still there
		if (onboardingFlowSection) {
			$(onboardingFlowSection).remove();
			$('#login').removeClass('hide');
		}

		// remove otp login page if its still there
		if (otpLoginSection) {
			$(otpLoginSection).remove();
			$('#login').removeClass('hide');
		}

		// remove verify otp page if its still there
		if (verifyOtpSection) {
			$(verifyOtpSection).remove();
			$('#login').removeClass('hide');
		}
		// Initiating this first since there is a need to load the template for overlay after pub cred XHR
		if(response && response.overlay && response.overlay.variant) {

			// set data attributes needed for overlay
			document.body.setAttribute('data-overlay-variant', response.overlay.variant);
			document.body.setAttribute('data-overlay-content-version', response.overlay.contentVersion || '');

			// initiate the lazy load for overlay
			login.loadResources && login.loadResources.lazyload();

			// hide the One Touch checkox if overlay for One Touch is to be shown
			var keepMeLogin = document.getElementById('keepMeLogin');
			if(keepMeLogin && response.overlay.variant === 'oneTouch'){
				$(keepMeLogin).addClass('hide');
			}
		}

		if (response.splitLoginContext === 'inputPassword' && newUserContainer) {
			if (startOnboardingFlow) {
				startOnboardingFlow.addClass('hide');
			}
			newUserContainer.addClass('hide');
		}

		if (response.splitLoginContext === 'inputEmail' && newUserContainer) {
			if (startOnboardingFlow) {
				startOnboardingFlow.removeClass('hide');
			}
			newUserContainer.removeClass('hide');
		}

		if (response.hidePwdTagLine && headerText) {
			headerText.addClass('hide');
		}

		if (!response.hidePwdTagLine && headerText) {
			headerText.removeClass('hide');
		}

		if (response.otpMayflyKey && loginForm) {
			login.utils.addHiddenElement('otpMayflyKey', response.otpMayflyKey, loginForm);
		}

		if (!response.otpMayflyKey && $('input[name=otpMayflyKey]')) {
			$('input[name=otpMayflyKey]').remove();
		}

		if (response.legalCountry && loginForm) {
			login.utils.addHiddenElement('legalCountry', response.legalCountry, loginForm);
		}

		if (!response.legalCountry && $('input[name=legalCountry]')) {
			$('input[name=legalCountry]').remove();
		}

		// Check if ADS intercepted via ngRL and issued a captcha
		if (response && response.htmlResponse) {
			login.ads.handleAdsInterception(decodeURIComponent(response.htmlResponse));
			return;
		}

		// No captcha issued
		// Redirect if no error and returnUrl in response
		if (response && response.returnUrl && !response.notifications) {
			window.location.href = response.returnUrl;
			return;
		}

		// Load ads challenge after clicking not you
		if (!response.profile && response.adsChallengeUrl) {
			login.ads.init(response.adsChallengeUrl);
		}

		if (response.showNoAccExists && login.noAccExists) {
			hideSpinner();
			login.noAccExists.showNoAccExistsView(response);
			return;
		}

		updateView(response);

		if (response.hideOnboardingFlowPwdPage && signupContainer) {
			signupContainer.addClass('hide');
		}

		if (login.otp) {
			login.otp.prepareSendPage(response);
		}

		if (response.verification && response.verification.page === 'pending') {
			login.verification.startPolling({
				accessToken: response.accessToken,
				authflowDocumentId: response.authflowDocumentId,
				_csrf: response._csrf,
				email: response.verification.email,
				variant: response.tpdVariant,
				tpdTriggerMethod: response.tpdTriggerMethod
			});
			login.verification.showResendLink();
		}

		if (response.tpdDemoRefresh && login.utils.isTpdDemo() && ctxId && ctxId.value) {
			ctxId.value = '';
			document.body.removeAttribute('data-is-prefill-email-enabled');
			document.body.removeAttribute('data-tpd-demo');
			document.body.removeAttribute('data-tpd-variant');
			window.location.href = '/signin';
		}

		// Hide the One Touch checkbox if keepMeLoggedInEnabled is false
		var keepMeLoginElement = document.getElementById('keepMeLogin');
		if(!response.keepMeLoggedInEnabled && keepMeLoginElement) {
			$(keepMeLoginElement).addClass('hide');
		}

		// Auto check the One Touch checkbox after pub cred response
		if(response.autoRememberMe) {
			var rememberMeElement = document.getElementById('keepMeLoggedIn');
			if(rememberMeElement){
				rememberMeElement.checked = true;
			}
		}

		setSliderToPasswordContainer();

		if (response.setBuyer) {
			setTimeout(function () {
				isFnDataLoaded() && login.xoPlanning.triggerSetBuyerCall(response.setBuyer);
			}, 300);
		}
	}

	/**
	 * Handle the failed XHR submission of email (or phone)
	 */
	function failedXhrSubmitHandler(response) {
		if (response.status === 429) {
			$(transitioningDiv).removeClass('spinner');
			return;
		}
		/*
		var parsedResponse, errorType = 'unknownError';
		if (response && response.responseText) {
			parsedResponse = JSON.parse(response.responseText);
			if (parsedResponse.csrfError) {
				errorType = 'securityTokenError';
			}
			if (parsedResponse.primaryInputError) {
				errorType = 'primaryInputError';
			}
		} else if (response && response.statusText === 'timeout') {
			errorType = 'timeoutError';
		} else if (response && response.statusText) {
			errorType = response.statusText;
		} else {
			// Do nothing
		}
		*/
		// TODO: Implement an elegant way to handle this
		window.location.href = window.location.href;
	}

	/**
	 * Generic handler for all click events
	 * @param {Object} event
	 */
	function documentClickHandler(event) {
		// trigger window_click event so subscribers can do their job
		if (login.pubsub) {
			login.pubsub.publish('WINDOW_CLICK', event);
		}
	}

	/**
	 * Function to show or hide the remember profile info tooltip
	 * TODO: Consider moving this to the view where it's DOM resides
	 * @param {Object} event
	 */
	function toggleRememberInfoTooltip(event) {
		var bubble = document.querySelector('.rememberProfile .bubble-tooltip');
		var $bubble, $target;

		if (!bubble || !event || !getEventTarget(event)) {
			return;
		}
		$bubble = $(bubble);
		$target = $(getEventTarget(event));

		if ($target.hasClass('infoLink') || $target.hasClass('bubble-tooltip')) {
			// cancel link default behavior
			eventPreventDefault(event);

			// toggle to show/hide the bubble when the link is clicked
			$bubble.toggle();
			return;
		}

		// any other place, hide the bubble
		$bubble.addClass('hide');
	}

	/**
	 * Chrome will not allow reading the password field on page load
	 * Attempt to see if it adds the light yellow color to the field instead
	 * Note: This is a best effort method and may not always work as expected
	 */
	function isChromePrefilledField(field) {
		return !!(field && window.chrome && window.chrome.webstore
		&& getComputedStyle(field).backgroundColor === 'rgb(250, 255, 189)');
	}

	/**
	 * Multipurpose method to check if a field is prefilled by the browser
	 */
	function isFieldPrefilled(field) {
		if (!field) {
			return false;
		}
		return isChromePrefilledField(field) || (field.value && field.value.length > 0);
	}

	function isInIframe () {
		return window.self !== window.top;
	}

	function getSplitLoginContext () {
		var splitLoginContext = document.querySelector('input[name="splitLoginContext"]');
		return splitLoginContext && splitLoginContext.value;
	}

	function getIntent() {
		var intentField = document.querySelector('input[name="intent"]');
		return (intentField && intentField.value) || '';
	}

	function getReturnUri() {
		var returnUriField = document.querySelector('input[name="returnUri"]');
		return (returnUriField && returnUriField.value) || '';
	}

	function getReturnUriState() {
		var stateField = document.querySelector('input[name="state"]');
		return (stateField && stateField.value) || '';
	}

	function getFlowId() {
		var flowId = document.querySelector('input[name=flowId]');
		return (flowId && flowId.value) || '';
	}

	function getSessionId() {
		var sessionId = document.querySelector('input[name=_sessionID]');
		return sessionId && sessionId.value;
	}

	function getKmliCb() {
		return document.querySelector('#keepMeLoggedIn');
	}

	/**
	 * Method to detect the Hermes app in-context merchant integration
	 *
	 * @returns {boolean}
	 */
	function isInContextIntegration() {
		return !!window.xprops;
	}

	/**
	 * Finds currently active Captcha component in split-login
	 * @param {Object} splitLoginContext
	 */
	function getActiveCaptchaElement(splitLoginContext) {
		var captchaElement;
		var splitLoginCookiedFallback = document.querySelector('input[name="splitLoginCookiedFallback"]');

		// non-split-login page
		if (!splitLoginContext || splitLoginCookiedFallback) {
			captchaElement = document.querySelector('#captcha');
			return getCaptchaDom(captchaElement);
		}

		switch (splitLoginContext.value) {
			case 'inputEmail':
				captchaElement = document.querySelector(isHybridLoginExperience() ? '#splitHybridCaptcha' : '#splitEmailCaptcha');
				break;
			case 'inputPhone':
				captchaElement = document.querySelector(isHybridLoginExperience() ? '#splitHybridCaptcha' : '#splitPhoneCaptcha');
				break;
			case 'inputPassword':
			case 'inputPin':
				captchaElement = document.querySelector(isHybridLoginExperience() ?
					'#splitHybridCaptcha' : '#splitPasswordCaptcha');
				break;
			case 'implicitEmail':
				captchaElement = document.querySelector('#implicitEmailCaptcha');
				break;
			default:
				captchaElement = null;
		}

		// A hidden captcha element should not have any effect
		if (captchaElement && $(captchaElement).hasClass('hide')) {
			return null;
		}
		return getCaptchaDom(captchaElement);
	}

	/**
	 * Returns the value of the query param passed in the given url
	 */
	function getQueryParamFromUrl(param, url) {
		url = decodeURIComponent(url);
		var queryStr = url && url.split('?')[1];
		var queryObj = {};
		if (!queryStr) {
			return;
		}
		queryStr.split('&').forEach(function(keyValue) {
			var split = keyValue.split('=');
			queryObj[split[0]] = split[1];
		});
		return queryObj[param];
	}

	/**
	 * Returns object containing query params key value
	 * pairs passed in the given url
	 *
	 * @param {Sring} url
	 */
	function getQueryParamsObj(url) {
		url = decodeURIComponent(url);
		var queryStr = url && url.split('?')[1];
		var queryObj = {};
		var keyValues, split;

		if (!queryStr) {
			return;
		}

		keyValues = queryStr.split('&');
		for (var i = 0; i < keyValues.length; i++) {
			split = keyValues[i].split('=');
			queryObj[split[0]] = split[1];
		}

		return queryObj;
	}

	/**
	 * Updates a URL by replacing one single param value
	 *
	 * @param {String} url
	 * @param {String} prop
	 * @param {String} newVal
	 */
	function updateParamValue(url, prop, newVal) {
		var paramsObj = login.utils.getQueryParamsObj(url);
		var val, href;

		// No query params in url
		if (!paramsObj) {
			return url[url.length - 1] === '?' ?
				url + prop + '=' + newVal :
				url + '?' + prop + '=' + newVal;
		}

		// prop has a value (ulPage=xyz OR ulPage=)
		if (paramsObj[prop] !== undefined) {
			val = paramsObj[prop];
			return url.replace(prop + '=' + val, prop + '=' + newVal);
		}

		// prop is not defined in the URL
		return url + '&' + prop + '=' + newVal;
	}

	function getCaptchaDom(wrapperElement) {
		if (!wrapperElement) {
			return null;
		}

		return {
			container: wrapperElement.querySelector('div.textInput'),
			field: wrapperElement.querySelector('input[type=text]'),
			errMsgContainer: wrapperElement.querySelector('div.errorMessage'),
			errMsg: wrapperElement.querySelector('div.errorMessage .emptyError'),
			playAudioBtn: wrapperElement.querySelector('.captchaPlay'),
			refreshCaptchaBtn: wrapperElement.querySelector('.captchaRefresh'),
			audioTag: wrapperElement.querySelector('.audio audio'),
			image: wrapperElement.querySelector('.captcha-image img'),
			audioLink: wrapperElement.querySelector('.audio a')
		};
	}

	function setSliderToPasswordContainer() {
		var splitPasswordDiv = document.querySelector('#splitPassword');
		if (splitPasswordDiv) {
			$(splitPasswordDiv).addClass('transformRightToLeft');
		}
	}

	function addHiddenElement(name, value, target) {
		var input = document.createElement('input');
		if (!target) {
			return;
		}
		input.setAttribute('type', 'hidden');
		input.setAttribute('name', name);
		input.setAttribute('value', value);
		target.appendChild(input);
	}

	/**
	 * Add a hidden element only if it does not exist
	 * @param {string} name
	 * @param {string} value
	 * @param {Element} target
	 */
	function addHiddenElementIfNotExist(name, value, target) {
		var check = target && target.querySelector('input[name="' + name  + '"]');
		if (check) {
			return;
		}
		addHiddenElement(name, value, target);
	}

	function doImpressionTracking(response) {
		try {
			PAYPAL.analytics.instance.recordImpression({data: response.sys.tracking.fpti.dataString});
		} catch (e) {}
	}

	function createIframe(attributes) {
		var iframeElement = document.createElement('iframe');
		var iframeAttributes = ['id', 'title', 'className', 'frameBorder', 'sandbox', 'src', 'style'];
		if (!attributes) {
			return;
		}
		for (var i = 0 ; i < iframeAttributes.length ; i++) {
			if (attributes[iframeAttributes[i]]) {
				iframeElement[iframeAttributes[i]] = attributes[iframeAttributes[i]];
			}
		}
		document.body.appendChild(iframeElement);
		return iframeElement;
	}

	function postPpBridgeMessage(msg) {
		var opener = window.opener;
		try {
			// Todo: Need to check with Helios team with the correct behavior for this,
			// Would ebay timeout if they dont receive post messages or if the redirection happens in MB
			// then checkout script would take care of it.
			msg = typeof msg === 'string' ? msg : JSON.stringify(msg);
			// If we are not in IE, attempt to send a postMessage
			if (opener && (window.navigator.userAgent.match(/edge/i) ||
				(opener.postMessage && !window.navigator.userAgent.match(/msie|trident/i)))) {
				opener.postMessage(msg, '*');
				return true;
			}
			// Otherwise, attempt to send a message through the iframe bridge
			var bridge = opener && opener.frames && opener.frames.length && opener.frames.PayPalBridge;

			if (bridge && bridge.returnToParent) {
				bridge.returnToParent(msg);
				return true;
			}
		} catch (err) {
			return false;
		}

		return false;
	}

	function isPpFrameMiniBrowser() {
		return window.opener && window.name && window.name.indexOf('PPFrame') === 0;
	}

	function updatePageLevelError(msg, msgTyp) {
		var notificationContainer = document.querySelector('.notifications');
		var paraEle, notificationMsg;

		if (notificationContainer) {
			paraEle = document.createElement('p');
			notificationMsg = document.createTextNode(msg);

			paraEle.setAttribute('class', 'notification ' + msgTyp);
			paraEle.setAttribute('role', 'alert');

			paraEle.appendChild(notificationMsg);
			notificationContainer.appendChild(paraEle);
		}
	}

	function getCSRFToken() {
		var tokenDOM = document.getElementById('token');
		return (tokenDOM && tokenDOM.value) || '';
	}

	function setCSRFToken(token) {
		var tokenDOM = document.getElementById('token');
		if (tokenDOM && token) {
			tokenDOM.value = token;
		}
	}

	function makeServerRequestAndReturnPromise(url, options) {
		return new Promise(function(resolve, reject) {
			var data = {};

			options = options || {};
			if (options.data) {
				data = options.data;
			}
			// Set the CSRF token
			data['_csrf'] = getCSRFToken();
			// Set the _sessionID for cookie-disabled browsers if not set
			data['_sessionID'] = data['_sessionID'] || getSessionId();
			// Show spinner default to all XHR calls
			showSpinner();

			$.ajax({
				type: options.method || 'POST',
				url: url,
				data: data,
				dataType: 'json',
				success: function(response) {
					if (response) {
						setCSRFToken(response['_csrf']);
						return resolve(response);
					} else {
						return reject();
					}
				},
				fail: function(err) {
					return reject(err);
				}
			});
		});
	}

	function isAndroidDevice() {
		return window.navigator.vendor === 'Google Inc.' &&
			navigator.userAgent.match(/Android/i)
	}

	/**
	 * Checks if a value looks like email and not like a phone.
	 * @param {String} value
	 * @return {Boolean}
	 */
	function doesItLookLikeEmail(value) {
		if (!value) { // It's true for empty values.
			return true;
		}

		// Remove all special phone chars: -().+ and a space. All of those are used in the NATIONAL phone format below:
		// https://engineering.paypalcorp.com/i18napp/#phone
		value = value.replace(/[-()\.\+\s]/ig, '');

		// If there is no string left after removing special phone characters or
		// if there is any non-digit character after removing phone specific characters, then it looks like email.
		return !value || value.search(/\D+/g) >= 0;
	}

	function isPrefillEmailEnabled() {
		return $('body').data('isPrefillEmailEnabled') === 'true';
	}

	function hidePasswordForPrefillHybrid() {
		var splitPasswordSection = document.querySelector('#splitPassword');
		splitPasswordSection && $(splitPasswordSection).addClass('hide');
	}

	function isPrefilledEmailNext() {
		var prefillEmailHybrid = document.querySelector('input[name=isPrefillEmailEnabled]');
		return prefillEmailHybrid && prefillEmailHybrid.value === 'true';
	}

	function renderPasswordFromPrefillHybridView() {
		var profileRememberedEmail = document.querySelector('.profileRememberedEmail');
		profileRememberedEmail && $(profileRememberedEmail).removeClass('cookiedProfile');
		setSliderToPasswordContainer();
		updateView({
			splitLoginContext: 'inputPassword',
			profile: {
				email: email && email.value
			},
			verification: null,
			notifications: null
		});
	}

	function isTpdDemo() {
		return $('body').data('tpdDemo') === 'true';
	}

	function getCtxId() {
		var ctxId = document.querySelector('input[name=ctxId]');
		return (ctxId && ctxId.value) || '';
	}

	/**
	 * Function to check if session is eligible for pwdless priority experience
	 * @param {Object} model
	 * @returns {boolean}
	 */
	function isPwdlessPriorityEnabled(model) {
		if (model) {
			return model.isPwdlessPriorityEnabled;
		}
		return !!($('body').data('isPwdlessPriorityEnabled'));
	}

	/**
	 * Function to check if One Touch User
	 * @returns {boolean}
	 */
	function isOTEligible() {
		var isOneTouchUser = !!(login.oneTouchLogin && $('body').data('oneTouchUser'));
		if (isOneTouchUser) {
			login.logger.log({
				evt: 'PWDLESS_PRIORITY_CLIENT',
				data: 'ONETOUCH_PRIORITY',
				calEvent: true
			});
			login.logger.pushLogs();
		}
		return isOneTouchUser;
	}

	/**
	 * Function to check if session is aPay eligible
	 * @param {Object} model
	 * @returns {boolean}
	 */
	function isAPayEnabled(model) {
		var ulData = (model && model.contextualLogin) || (window.PAYPAL && window.PAYPAL.ulData) || {};
		var isPwdlessPriorityFeatureEnabled = isPwdlessPriorityEnabled(model);
		var isAPayEligible = isPwdlessPriorityFeatureEnabled && ulData.aPayAuth && isAPaySupported();

		// Android Pay is not eligible if Hard Decline OR if not within pwdLessPriority feature
		if (ulData.canNotMakePayment || !isPwdlessPriorityFeatureEnabled) {
			return false;
		}
		if (isAPayEligible) {
			login.logger.log({
				evt: 'PWDLESS_PRIORITY_CLIENT',
				data: 'APAY_PRIORITY',
				calEvent: true
			});

			login.logger.pushLogs();
		}
		return isAPayEligible;
	}

	/**
	 * Function to check if session is GSL Activation eligible
	 * @param {Object} model
	 * @returns {boolean}
	 */
	function isSLActivation(model) {
		var slAction = (model && model.slAction) ||
			window.PAYPAL && window.PAYPAL.slData && window.PAYPAL.slData.slAction;

		if (slAction === 'activation' && login.smartLock) {
			login.logger.log({
				evt: 'PWDLESS_PRIORITY_CLIENT',
				data: 'SL_PRIORITY',
				calEvent: true
			});

			login.logger.pushLogs();
			return true;
		}
		return false;
	}

	/**
	 * Function to check if session is eligible for WebAuthn Login
	 * @returns {boolean}
	 */
	function isWebAuthnEligible() {
		var isWebAuthnEligible = !!(login.webAuthn && login.webAuthn.setContext && $('body').data('webAuthnLoginContext'));
		if (isWebAuthnEligible) {
			login.logger.log({
				evt: 'PWDLESS_PRIORITY_CLIENT',
				data: 'WEB_AUTHN_PRIORITY',
				calEvent: true
			});

			login.logger.pushLogs();
		}
		return isWebAuthnEligible;
	}

	/**
	 * Add an event handler to a DOM that will be invoked when autofill happens
	 * Verified to work as expected on Webkit browsers Chrome and Safari
	 * @param {Element} dom
	 */
	function addAutofillEventHandler(dom, handler) {
		if (!dom || !handler || typeof handler !== 'function') {
			return;
		}

		addEvent(dom, 'input', function onInput(e) {
			eventPreventDefault(e);
			var inputType = e.inputType;
			var data = e.data;

			if (inputType === 'insertText' || inputType === 'deleteContentBackward' || inputType === 'insertFromPaste') {
				return true;
			}

			if (!data) {
				return handler(e);
			}
		});
	}

	/**
	 * function to safely parse string into JSON.
	 * @param {String} jsonData
	 */
	function parseJsonSafe(jsonData) {
		var parsedData;
		try {
			parsedData = JSON.parse(jsonData);
			return parsedData;
		} catch (e) {
			return {};
		}
	}

	/**
	 * function to determine if the given browser is in private mode,
	 * only supported for Safari and Chrome at the moment.
	 * @param {function} callback will return an object containing isPrivate property, true if private mode,
	 * false otherwise.
	 */
	function isBrowserInPrivateMode(callback) {
		if (window.webkitRequestFileSystem) {
			window.webkitRequestFileSystem(
				window.TEMPORARY, 1,
				function() {
					callback({isPrivate: false});
				},
				function() {
					callback({isPrivate: true});
				}
			);
		} else if (/Safari/.test(window.navigator.userAgent)) {
			try {
				if (!window.localStorage) {
					callback({isPrivate: true});
				}
				window.openDatabase(null, null, null, null);
				window.localStorage.setItem('test', 1);

				if (window.localStorage.getItem('test') === '1') {
					window.localStorage.removeItem('test');
					callback({isPrivate: false});
				}
			} catch(e) {
				callback({isPrivate: true});
			}

		} else {
			callback({isPrivate: false});
		}
	}

	function isFnDataLoaded() {
		var fnSyncData = document.querySelector('input[name="fn_sync_data"]');
		return fnSyncData && fnSyncData.value;
	}

	/**
	 * Returns true if the user's browser has cookie disabled
	 * @returns {boolean}
	 */
	function isCookieDisabledBrowser() {
		try {
			return !(typeof document.cookie === 'string' && document.cookie.length > 0);
		}
		catch (e) {
			return true;
		}
	}

	/**
	 * Do a SSR internal redirect
	 * @param {Object} options
	 * @param {string} options.returnUrl
	 * @param {string} options.accessToken
	 * @param {string} options.intent
	 */
	function handleSlrInternalRedirect(options) {
		options = options || {};
		var sessionID = getSessionId();
		var csrf = getCSRFToken();
		var redirectFormDOM = document.createElement('form');
		$(redirectFormDOM).attr('method', 'POST');
		$(redirectFormDOM).attr('action', '/signin/iroute');
		addHiddenElement('_csrf', csrf, redirectFormDOM);
		addHiddenElement('_sessionID', sessionID, redirectFormDOM);
		addHiddenElement('accessToken', options.accessToken, redirectFormDOM);
		addHiddenElement('returnUrl', options.returnUrl, redirectFormDOM);
		document.body.appendChild(redirectFormDOM);
		return redirectFormDOM.submit();
	}

	function sendPostMessage(event) {
		if (PAYPAL.unifiedLoginInlinePostMessage &&
			typeof PAYPAL.unifiedLoginInlinePostMessage.processAndPostMessage === 'function') {
			PAYPAL.unifiedLoginInlinePostMessage.processAndPostMessage({
				event: event
			});
		}
	}

	/**
	 * Returns true if Sign in with Apple activation in under process
	 * @returns {boolean}
	 */
	function isSiAppleActivationProcessing() {
		return !!document.querySelector('input[name="isSiAppleActivationProcessing"]');
	}

	function createCache() {
		var _resourceCache = {};
		function update(data) {
			_resourceCache = Object.assign(_resourceCache, data);
		}

		function get(property) {
			return _resourceCache[property];
		}

		function clear(property) {
			if (_resourceCache[property]) {
				delete _resourceCache[property];
			}
		}
		return {
			update: update,
			get: get,
			clear: clear
		}
	}

	/**
	 *
	 * @returns {boolean}
	 */
	function isWebView() {
		var userAgent = window.navigator.userAgent;
		return (/(iPhone|iPod|iPad|Macintosh).*AppleWebKit(?!.*Safari)/i).test(userAgent) ||
			(/\bwv\b/).test(userAgent) ||
		(/Android.*Version\/(\d)\.(\d)/i).test(userAgent);
	}
	function isSpinnerShown() {
		var transitioningDiv = document.querySelector('.transitioning');
		return $(transitioningDiv).hasClass('spinner') || $(transitioningDiv).hasClass('spinnerWithLockIcon');
	}

	function logCPLData(data) {
		data = data || {};
		login.logger.log({evt: 'state_name', data: 'CPL_LATENCY_METRICS', instrument: true});
		login.logger.log({evt: 'login_experience', data: data.flowName, instrument: true});
		var tt = JSON.stringify({
			'start': data.startTime,
			'tt': Date.now() - data.startTime
		});
		login.logger.log({evt: 'login_auth_time',
			data: tt,
			instrument: true});
		login.logger.log({evt: 'status', data: data.status, instrument: true});
		login.logger.pushLogs();
	}

	function isUserAgentIneligibleForTimeout() {
		var userAgent = window.navigator.userAgent;
		var xhrTimeoutIneligibleList = $('body').data('xhrTimeoutIneligibleList') && $('body').data('xhrTimeoutIneligibleList').split("|");
		for (var i = 0; i < xhrTimeoutIneligibleList.length; i++) {
			if (userAgent.indexOf(xhrTimeoutIneligibleList[i]) > -1) {
				return true;
			}
		};
		return false;
	}

	function isAppDownloadBannerSupported() {
		return !!($('body').data('appDownloadBanner'));
	}

	return {
		showSpinner: showSpinner,
		hideSpinner: hideSpinner,
		showSpinnerMessage: showSpinnerMessage,
		hideSpinnerMessage: hideSpinnerMessage,
		getOutboundLinksHandler: getOutboundLinksHandler,
		isFieldPrefilled: isFieldPrefilled,
		notYouClickHandler: notYouClickHandler,
		notYouClickHandlerForCookiedUser: notYouClickHandlerForCookiedUser,
		getEmptyPattern: getEmptyPattern,
		getEmailPattern: getEmailPattern,
		getInvalidUserIdPattern: getInvalidUserIdPattern,
		submitPublicCredential: submitPublicCredential,
		successfulXhrHandler: successfulXhrHandler,
		failedXhrSubmitHandler: failedXhrSubmitHandler,
		documentClickHandler: documentClickHandler,
		toggleRememberInfoTooltip: toggleRememberInfoTooltip,
		updateView: updateView,
		isInIframe: isInIframe,
		isInContextIntegration: isInContextIntegration,
		getSplitLoginContext: getSplitLoginContext,
		getIntent: getIntent,
		getReturnUri: getReturnUri,
		getReturnUriState: getReturnUriState,
		getFlowId: getFlowId,
		getSessionId: getSessionId,
		getKmliCb: getKmliCb,
		getActiveCaptchaElement: getActiveCaptchaElement,
		getCaptchaDom: getCaptchaDom,
		getQueryParamFromUrl: getQueryParamFromUrl,
		setSliderToPasswordContainer: setSliderToPasswordContainer,
		getQueryParamsObj: getQueryParamsObj,
		updateParamValue: updateParamValue,
		addHiddenElement: addHiddenElement,
		addHiddenElementIfNotExist: addHiddenElementIfNotExist,
		doImpressionTracking: doImpressionTracking,
		createIframe: createIframe,
		postPpBridgeMessage: postPpBridgeMessage,
		isPpFrameMiniBrowser: isPpFrameMiniBrowser,
		updatePageLevelError: updatePageLevelError,
		makeServerRequestAndReturnPromise: makeServerRequestAndReturnPromise,
		getCSRFToken: getCSRFToken,
		setCSRFToken: setCSRFToken,
		isAndroidDevice: isAndroidDevice,
		doesItLookLikeEmail: doesItLookLikeEmail,
		isHybridLoginExperience: isHybridLoginExperience,
		isHybridEditableOnCookied: isHybridEditableOnCookied,
		isPrefillEmailEnabled: isPrefillEmailEnabled,
		hidePasswordForPrefillHybrid: hidePasswordForPrefillHybrid,
		isPrefilledEmailNext: isPrefilledEmailNext,
		renderPasswordFromPrefillHybridView: renderPasswordFromPrefillHybridView,
		isTpdDemo: isTpdDemo,
		getCtxId: getCtxId,
		isPwdlessPriorityEnabled: isPwdlessPriorityEnabled,
		isOTEligible: isOTEligible,
		isAPayEnabled: isAPayEnabled,
		isSLActivation: isSLActivation,
		isWebAuthnEligible: isWebAuthnEligible,
		addAutofillEventHandler: addAutofillEventHandler,
		parseJsonSafe: parseJsonSafe,
		isBrowserInPrivateMode: isBrowserInPrivateMode,
		isFnDataLoaded: isFnDataLoaded,
		isCookieDisabledBrowser: isCookieDisabledBrowser,
		handleSlrInternalRedirect: handleSlrInternalRedirect,
		sendPostMessage: sendPostMessage,
		isSiAppleActivationProcessing: isSiAppleActivationProcessing,
		createCache: createCache,
		isWebView: isWebView,
		switchToEmailHandler: switchToEmailHandler,
		isSpinnerShown: isSpinnerShown,
		logCPLData: logCPLData,
		isUserAgentIneligibleForTimeout: isUserAgentIneligibleForTimeout,
		isAppDownloadBannerSupported: isAppDownloadBannerSupported,
		updateOnboardingButton: updateOnboardingButton
	};
}());

login.storageUtils = (function(){
	var localStorageCalName = 'LOCALSTORAGE';
	/**
	 * Extend and store the value in localstorage
	 * @param name
	 * @param value
	 * @param userId
	 */
	function setDataByUserId(name, value, userId) {
		var ulData, userUlData;
		ulData = readLocalStorage();
		userUlData = ulData[userId] || {};
		userUlData[name] = value;
		ulData[userId] = userUlData;
		try {
			window.localStorage.setItem('ulData', JSON.stringify(ulData));
		} catch(e) {
			login.logger.log({
				evt: localStorageCalName,
				data: e,
				calEvent: true,
				status: 'ERROR'
			});
			login.logger.pushLogs();
		}
	}

	/**
	 * load the specific value from a specific user in localstorage
	 * @param name
	 * @param userId
	 * @returns {*}
	 */
	function readDataByUserId(name, userId) {
		var ulData;
		ulData = readLocalStorage();
		return ulData[userId] && ulData[userId][name];
	}

	/**
	 * load ulData value in localstorage
	 * @param userId
	 * @returns {(any | {}) | {}}
	 */
	function readLocalStorage() {
		try {
			var ulData;
			ulData = JSON.parse(window.localStorage.getItem('ulData')) || {};
		} catch(e) {
			login.logger.log({
				evt: localStorageCalName,
				data: e,
				calEvent: true,
				status: 'ERROR'
			});
			login.logger.pushLogs();
		}
		return ulData || {};
	}

	/**
	 * remove the specific value from specific user in localstorage
	 * @param name
	 * @param userId
	 */
	function removeDataByUserId(name, userId) {
		var ulData;
		ulData = readLocalStorage();
		if (ulData[userId]) {
			delete ulData[userId][name];
			try {
				window.localStorage.setItem('ulData', JSON.stringify(ulData));
			} catch(e) {
				login.logger.log({
					evt: localStorageCalName,
					data: e,
					calEvent: true,
					status: 'ERROR'
				});
				login.logger.pushLogs();
			}
		}
	}
	return {
		setDataByUserId: setDataByUserId,
		readDataByUserId: readDataByUserId,
		removeDataByUserId: removeDataByUserId
	};
}());

login.countryList = (function() {
	var _resourceCache = {};
	var utils = login.utils;

	function updateCache(data) {
		_resourceCache = Object.assign(_resourceCache, data);
	}

	function getCache(property) {
		return _resourceCache[property];
	}

	function showCountryDropDown(data) {
		var main = document.querySelector('.main');

		/**
		 * Only insert the country list DOM in the page when the country picker is clicked
		 */
		function insertDom() {
			main.insertAdjacentHTML('beforeend', getCache('countryList').html);
			setTimeout(function() {
				$('.countryListModal').addClass('transitionUp');
			}, 10);
			window.scrollTo({top: 0});
			login.logger.log({
				evt: 'actiontype',
				data: 'country_overlay_loaded',
				instrument: true
			});
			login.logger.log({
				evt: 'COUNTRY_LIST',
				data: 'COUNTRY_OVERLAY_LOADED',
				calEvent: true
			});
			var countrySelector = document.querySelector('.countryListModal .country-selector');
			var closeModal = document.querySelector('.countryListModal .closeModal');
			// Focus the close button when country list modal is opened 
			closeModal.focus();
			// Remove the DOM on close because it is already available in cache
			addEvent(closeModal, 'click', function() {
				$('.countryListModal').removeClass('transitionUp');
				setTimeout(function() {
					$('.countryListModal').remove();
				}, 300);
				login.logger.pushLogs();
			});
			// Event on the parent element to which clicks on individual country links bubbles up
			addEvent(countrySelector, 'click', function(e) {
				var target = getEventTarget(e);
				if (target.tagName === 'A') {
					$('.countryListModal').removeClass('transitionUp');
					var countryCode = $(target).data('countryCode');
					var locale = $(target).data('locale');
					var requestUrl = $('input[name=requestUrl]').val();
					if (locale && countryCode) {
						login.logger.log({
							evt: 'actiontype',
							data: 'click_country_change',
							instrument: true
						});
						login.logger.log({
							evt: 'COUNTRY_LIST',
							data: 'CLICK_COUNTRY_CHANGE',
							calEvent: true
						});
						requestUrl = utils.updateParamValue(requestUrl, 'country.x', countryCode);
						requestUrl = utils.updateParamValue(requestUrl, 'locale.x', locale);
						utils.showSpinner();
						setTimeout(function() {
							window.location.href = requestUrl;
						}, 300);
					} else {
						setTimeout(function() {
							$('.countryListModal').remove();
						}, 300);
					}
					login.logger.pushLogs();
				}
			});
		}

		function handleCountryPicker() {
			var countryPickers = document.querySelectorAll('.picker button');
			countryPickers.forEach(function(countryPicker) {
				$(countryPicker.parentElement).removeClass('hide');
				addEvent(countryPicker, 'click', function() {
					login.logger.log({
						evt: 'actiontype',
						data: 'click_country_picker',
						instrument: true
					});
					login.logger.log({
						evt: 'COUNTRY_LIST',
						data: 'CLICK_COUNTRY_PICKER',
						calEvent: true
					});
					insertDom();
				});
			});
		}
		var countryListCache = getCache('countryList');
		if(!data && countryListCache) {
			// When lazy load XHR returns a country list show country picker flag and attach click event
			data = countryListCache;
			handleCountryPicker();
		}

		if (data.countryList) {
			// When lazy load XHR returns a country list show country picker flag and attach click event
			document.head.insertAdjacentHTML('beforeend', data.countryList.css);
			updateCache({countryList: data.countryList});
			handleCountryPicker();
		}
	}

	return {
		updateCache: updateCache,
		getCache: getCache,
		showCountryDropDown: showCountryDropDown
	}

}());

login.loadResources = (function() {
	var utils = login.utils;

	// Do not combine the two endpoints
	// The cookie banner is for compliance and should be independent
	// Use load resources endpoint for all the lazy loading for UL
	function showCookieBanner() {
		var cookieBannerJs,
			url = '/signin/cookie-banner',
			cookieBannerVariant = $('body').data('cookieBannerVariant') || '',
			flowId = utils.getFlowId() || '';
		var params = {
			flowId: flowId,
			cookieBannerVariant: cookieBannerVariant
		};
		var query = Object.keys(params);
		for(var i = 0; i < query.length; i++) {
			if(i === 0) url = url + '?';
			url = params[query[i]]? url + query[i] + '=' + params[query[i]] + '&' : url;
		}

		$.ajax({
			method: 'GET',
			url: url,
			success: function(response) {
				var bannerData = response && response.data && response.data.cookieBanner;
				var gdprCookieBanner;
				var bannerHeight = 0;
				// check if all the content to present the banner are available
				if (!bannerData) {
					return;
				}
				// CSS append to the head
				document.querySelector('head').insertAdjacentHTML('beforeend', bannerData.css);
				// html append into the dom
				document.querySelector('#main').insertAdjacentHTML('beforeend', bannerData.html);
				// js append into the body
				cookieBannerJs = document.createElement('script');
				cookieBannerJs.setAttribute('nonce', $('body').data('nonce'));
				// Remove script tags that Cookie Banner responses before appending
				cookieBannerJs.innerHTML = bannerData.js.replace(/^<script[^>]*>|<\/script>$/g, '');
				$('body').append(cookieBannerJs);
				// trigger cookie banner JS after document finished loading
				if (typeof window.bindGdprEvents === 'function') {
					window.bindGdprEvents();
				}
				gdprCookieBanner = document.querySelector('#gdprCookieBanner');
				// Add an empty div to scroll the page on mobile version
				if (gdprCookieBanner) {
					bannerHeight = $(gdprCookieBanner).outerHeight();
					document.querySelector('body').style.marginBottom = bannerHeight + 'px';
				}
			}
		});
	}

	function showAppDownloadBanner() {
		var appDownloadBannerJs,
			flowId = utils.getFlowId(),
			returnUri = utils.getReturnUri() || '',
			url = '/signin/app-download-banner?returnUrl=' + encodeURIComponent(returnUri);
		if (flowId) {
			url = url + '&flowId=' + flowId;
		}

		$.ajax({
			method: 'GET',
			url: url,
			success: function(response) {
				var bannerData = response && response.data && response.data.appDownloadMobileBanner;
				// check if all the content to present the banner are available
				if (!bannerData) {
					return;
				}
				// CSS append to the head
				document.querySelector('head').insertAdjacentHTML('beforeend', bannerData.css);
				// html append into the dom
				document.querySelector('#main').insertAdjacentHTML('beforebegin', bannerData.html);
				// js append into the body
				appDownloadBannerJs = document.createElement('script');
				appDownloadBannerJs.setAttribute('nonce', $('body').data('nonce'));
				// Remove script tags that Cookie Banner responses before appending
				appDownloadBannerJs.innerHTML = bannerData.js.replace(/^<script[^>]*>|<\/script>$/g, '');
				$('body').append(appDownloadBannerJs);
			}
		});
	}

	function onLoadCountryCodes(data) {
		var codesDropDown = document.querySelector('#phoneCode');
		var fragment = document.createDocumentFragment();
		var countryCodes = data && data.countryPhoneList;
		var phoneCode = data && data.phoneCode;
		var element;

		if (!countryCodes || !countryCodes.length || !codesDropDown) {
			return;
		}

		for (var i = 0; i < countryCodes.length; i++) {
			element = document.createElement('option');
			element.value = countryCodes[i].$value;
			element.setAttribute('data-code', countryCodes[i].$code);
			element.setAttribute('data-country', countryCodes[i].$country);
			element.textContent = countryCodes[i].$elt;
			if (countryCodes[i].$value === phoneCode) {
				element.setAttribute('selected', 'selected');
			}
			fragment.appendChild(element);
		}

		// Remove current child and append all new children elements
		codesDropDown.innerHTML = '';
		codesDropDown.appendChild(fragment);
	}

	function appendOverlayTemplate(data){
		var loginSection = document.querySelector('#login');
		if(loginSection && data.overlayTemplate) {
			loginSection.insertAdjacentHTML('beforeend', data.overlayTemplate);
		}
	}

	function lazyload() {
		var localeField = document.querySelector('input[name="locale.x"]');
		var locale = localeField && localeField.value;
		var url = '/signin/load-resource';
		var attempts = 0;
		var maxAttempts = 2;

		function makeRequest() {
			var payload = {
				_csrf: utils.getCSRFToken(),
				flowId: utils.getFlowId(),
				intent: utils.getIntent()
			};
			var proceedWithLazyload = false;
			var overlayVariant = $('body').data('overlay-variant');

			// Stop trying after max attempts
			if (attempts > maxAttempts) {
				return;
			}

			if ($('body').data('lazyLoadCountryCodes') === 'true') {
				payload['lazyLoadCountryCodes'] = true;
				payload['locale.x'] = locale;
				proceedWithLazyload = true;
			}

			if(overlayVariant) {
				payload['overlayVariant'] = overlayVariant;
				payload['overlayContentVersion'] = $('body').data('overlay-content-version');
				login.utils.addHiddenElement('overlayVariant', overlayVariant, document.querySelector('form[name=login]'));
				proceedWithLazyload = true;
			}

			if (login.countryList && $(document.body).data('showCountryDropDown') === 'true' && !login.countryList.getCache('countryList')) {
				payload.showCountryDropDown = 'true';
				proceedWithLazyload = true;
			}

			if (!proceedWithLazyload) {
				return;
			}

			attempts += 1;
			$.ajax({
				url: url,
				method: 'POST',
				data: payload,
				success: function(response) {
					if (login.countryList && login.countryList.showCountryDropDown) {
						login.countryList.showCountryDropDown(response);
					}
					onLoadCountryCodes(response);
					appendOverlayTemplate(response);
				},
				fail: makeRequest // try again
			});
		}

		makeRequest();
	}

	return {
		showCookieBanner: showCookieBanner,
		showAppDownloadBanner: showAppDownloadBanner,
		lazyload: lazyload
	};
}());

(function() {
	/**
	 * Custom library which supports DOM manipulation
	 * @param {Object} element The DOM object
	 */
	var _DOM = function(element) {
		if (typeof element === 'string') {
			element = document.querySelector(element);
		}

		if (!element) {
			return;
		}

		/**
		 * Check if the element contains specified class
		 * @param {String} className To check the class name
		 * @returns {boolean}
		 */
		function hasClass(className) {
			if (element.classList) {
				return element.classList.contains(className);
			} else {
				return !!element.className.match(new RegExp('(\\s|^)' + className + '(\\s|$)'));
			}
		}

		/**
		 * Add class to the element
		 * @param {String} className Add to the specified element
		 */
		function addClass(className) {
			if (element.classList) {
				element.classList.add(className);
			} else if (!hasClass(className)) {
				element.className += ' ' + className;
			}
		}

		/**
		 * Remove class from the element
		 * @param {String} className Remove from the specified element
		 */
		function removeClass(className) {
			if (element.classList) {
				element.classList.remove(className);
			} else if (hasClass(className)) {
				var reg = new RegExp('(\\s|^)' + className + '(\\s|$)');
				element.className = element.className.replace(reg, ' ')
			}
		}

		/**
		 * Access (or set) data attribute on an element
		 * @param {String} attr Camel cased data attribute name
		 */
		function data(attr, value) {
			var decamelizedAttr;
			if (typeof attr !== 'string') {
				return;
			}
			decamelizedAttr = 'data-' + attr.replace(/([A-Z])/g, '-$1').toLowerCase();

			if (value) {
				element.setAttribute(decamelizedAttr, value);
			} else {
				return element.getAttribute(decamelizedAttr);
			}
		}

		/**
		 * Return the outer height of an element
		 * Add top and bottom margins in case of IE9+
		 */
		function outerHeight() {
			var style, height = element.offsetHeight;
			if (typeof getComputedStyle === 'undefined') {
				return height;
			}

			style = getComputedStyle(element);
			height += parseInt(style.marginTop) + parseInt(style.marginBottom);

			return height;
		}

		/**
		 * Get and set attribute for an element
		 * @param {Object} attribute
		 * @param {Object} value
		 */
		function attr(attribute, value) {
			if (!value) {
				return element.getAttribute(attribute);
			} else {
				return element.setAttribute(attribute, value);
			}
		}

		/**
		 * Find elements with the defined selector under the element
		 * @param {Object} field
		 */
		function find(field) {
			return element.querySelectorAll(field);
		}

		/**
		 * Set or get text from an element.
		 */
		function text(str) {
			var isElementTextContentAvailable = element.textContent !== undefined && element.textContent !== null;
			if (str === undefined) {
				return isElementTextContentAvailable ? element.textContent : element.innerText;
			}
			if (isElementTextContentAvailable) {
				element.textContent = str;
			} else {
				element.innerText = str;
			}
		}

		/**
		 * Remove an element from the DOM
		 */
		function remove() {
			element.parentNode.removeChild(element);
		}

		/**
		 * Toggle show/hide by adding or removing .hide css class
		 */
		function toggle() {
			if (hasClass('hide')) {
				removeClass('hide');
			} else {
				addClass('hide');
			}
		}

		function append(childEle) {
			element.appendChild(childEle);
		}

		function focus() {
			element.focus();
		}

		function val(inputValue) {
			if (!inputValue) {
				return element.value;
			}
			element.value = inputValue;
		}

		return {
			hasClass: hasClass,
			addClass: addClass,
			removeClass: removeClass,
			data: data,
			outerHeight: outerHeight,
			text: text,
			attr: attr,
			find: find,
			remove: remove,
			toggle: toggle,
			append: append,
			focus: focus,
			val: val
		};
	};

	/**
	 * Generic ajax request
	 * @param {Object} options Object to state the URL, POST data, callbacks etc
	 */
	_DOM.ajax = function(options) {
		var xhr, response, hdr, serializedData = [], prop;
		var sessionIdDOM = document.querySelector('input[name=_sessionID]');
		if (!options || options && !options.url) {
			return;
		}

		try {
			xhr = window.XMLHttpRequest ? new XMLHttpRequest() : new ActiveXObject('Microsoft.XMLHTTP');
		} catch (e) {
			// TODO: Track this browser that doesnt let us do XHR
		}

		if (!xhr) {
			return;
		}
		if (options.onErrorEnabled) {
			xhr.onerror = function () {
				// handle network failure/disconnect when start the xhr call
				if (!xhr.status && typeof options.fail === 'function') {
					options.fail(xhr);
				}
			};
		}
		if(options.timeoutEnable){
			xhr.timeout = $('body').data('xhrTimeoutLimit');
			try {
				xhr.ontimeout = function (e) {
					if (xhr.status !== 200 && typeof options.fail === 'function') {
						login.logger.log({
							evt: 'TIMEOUT_WRAPPER',
							data: 'TIMEOUT_ERROR'+ options.url.replace(/\//g,'_').toUpperCase(),
							calEvent: true
						});
						login.logger.log({
							evt: 'int_error_desc',
							data: 'timeout_error',
							instrument: true
						});
						login.logger.pushLogs();
						options.fail(xhr);
					}
				};
			} catch(err) {
				login.logger.log({
					evt: 'TIMEOUT_WRAPPER',
					data: 'TIMEOUT_USER_AGENT_ERROR',
					calEvent: true
				});
				login.logger.log({
					evt: 'int_error_desc',
					data: 'timeout_error_user_agent',
					instrument: true
				});
				login.logger.pushLogs();
			}
		}

		options.method = options.method || 'POST';

		if (options.data && typeof options.data !== 'string') {
			// Set the _sessionID for cookie-disabled browsers if not set
			options.data._sessionID = options.data._sessionID || (sessionIdDOM && sessionIdDOM.value);
			for (prop in options.data) {
				serializedData.push(encodeURIComponent(prop) + '=' + encodeURIComponent(options.data[prop]));
			}
		}

		xhr.onreadystatechange = function() {
			if (xhr.readyState !== 4) {
				return;
			}

			response = xhr.response || xhr.responseText;
			if (xhr.status === 200 && response) {
				// Since (here) status is 200, the response is either JSON or plain text (or html string)
				try {
					response = JSON.parse(response);
				} catch (e) {
					// No need to do anything (in most cases this means non JSON response)
				}

				typeof options.success === 'function' && options.success(response);
			}
			if (xhr.status !== 200 && typeof options.fail === 'function' && xhr.status !== 0) {
				options.fail(xhr); // xhr.status is 0 by default
			}

			typeof options.complete === 'function' && options.complete();
		};

		xhr.open(options.method, options.url);
		xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
		if (options.method === 'POST') {
			xhr.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
			xhr.setRequestHeader('Accept', 'application/json');
		}

		if (options.method === 'GET') {
			xhr.setRequestHeader('Accept', 'application/json');
		}

		if (typeof options.headers === 'object' && options.headers.length) {
			for (hdr in options.headers) {
				xhr.setRequestHeader(hdr, options.headers[hdr]);
			}
		}

		xhr.send(serializedData && serializedData.join('&'));
		return xhr;
	};
	window.$ = _DOM;
})();

// VIEW
login.view = (function() {
	function render(state) {
		var splitLoginContext = document.querySelector('input[name=splitLoginContext]');
		var model = (state && state.model) || {};
		if (typeof window.showGdprBanner === 'function') {
			window.showGdprBanner();
		}
		splitLoginContext.value = model.splitLoginContext;
		updateViewAfterAds(model);
		updateNotificationView(model);
		updateEmailView(model);
		updatePinView(model);
		updatePasswordView(model);
		updateProfileView(model);
		updateSignupView(model);
		updateCaptchaDom(model);
		updateVerificationView(model);
		updateSubHeaderView(model);
		updateHybridLoginView(model);
		if (login.verification) {
			login.verification.updateView(model);
		}
		updateWebAuthnView(model);
	}

	function updateWebAuthnView(model) {
		var fieldWrapperPassword = document.querySelector('#password').parentElement;
		var textInputPassword = fieldWrapperPassword.parentElement;
		var webAuthnFpIconEnabled = model.webAuthnFpIconEnabled;
		if(model.partyIdHash) {
			login.utils.addHiddenElement('partyIdHash', model.partyIdHash, document.querySelector('form[name=login]'));
			document.body.setAttribute('data-party-id-hash', model.partyIdHash);
		}
		if (model.webAuthnLoginContext && login.webAuthn && login.webAuthn.setContext && !model.verification) {
			login.webAuthn.setContext(model);
			if (!webAuthnFpIconEnabled) {
				return;
			}
			document.body.setAttribute('data-web-authn-login-context', model.webAuthnLoginContext);
			login.utils.addHiddenElement('webAuthnLoginContext', model.webAuthnLoginContext, document.querySelector('form[name=login]'));
			if (model.wanSupportLookup) {
				document.body.setAttribute('data-web-authn-support-lookup', 'true');
			}
			textInputPassword && $(textInputPassword).addClass('errorMessageFp');
			if (model.isRtl) {
				fieldWrapperPassword && $(fieldWrapperPassword).addClass('rtlFpPlaceholder');
			} else {
				fieldWrapperPassword && $(fieldWrapperPassword).removeClass('rtlFpPlaceholder');
			}
		}
	}

	function updateHybridLoginView(model) {
		var emailField = document.querySelector('#email');
		var emailLabel = document.querySelector('label[for="email"]');
		var phoneField = document.querySelector('#phone');
		var isTpdOnboardedField = document.querySelector('#isTpdOnboarded');
		var countryPhoneSelectWrapper = document.querySelector('.countryPhoneSelectWrapper');
		var emailContainer = document.querySelector('#login_emaildiv');
		var profileRememberedEmail = document.querySelector('.profileRememberedEmail');

		// Enable fields for email and phone when a user goes back to the first page, so they can be used.
		if (!model.profile) {
			emailField && emailField.removeAttribute('disabled');
			phoneField && phoneField.removeAttribute('disabled');
		}

		// Switch to the email login experience by hiding phone specific DOM.
		countryPhoneSelectWrapper && $(countryPhoneSelectWrapper).addClass('hide');
		emailContainer && $(emailContainer).removeClass('phoneInputWrapper');

		// Remove cookied profile CSS when there is no profile to prefill.
		if (!model.profile && profileRememberedEmail) {
			$(profileRememberedEmail).removeClass('cookiedProfile');
		}

		// Clean up a field that wasn't used on the hybrid login page.
		if (!model.phone && phoneField) {
			phoneField.value = null;
		} else if (model.phone && emailField) {
			emailField.value = null;
		}

		// Phone hybrid login failed, so enforce email only hybrid login on 8ball.
		if (model.notifications && model.hybridInEmailOnlyMode && model.contextualLogin && model.contextualLogin.content) {
			emailField && $(emailField).attr('placeholder', model.contextualLogin.content.emailLabel);
			if (emailLabel) {
				$(emailLabel).text(model.contextualLogin.content.emailLabel);
			}
			emailField && $(emailField).attr('data-hybrid-in-email-only-mode', model.hybridInEmailOnlyMode);
		}

		if (isTpdOnboardedField && model.profile && model.isTpdOnboarded) {
			isTpdOnboardedField.value = model.isTpdOnboarded;
		}
	}

	function updateEmailView(model) {
		var splitEmailAndPhoneDom = document.querySelector('#splitEmail'); // #splitEmail contains the email & phone fields
		var splitEmailSection = document.querySelector('#splitEmailSection');
		var splitPhoneSection = document.querySelector('#splitPhoneSection');
		var rememberProfileDom = document.querySelector('#rememberProfileEmail');
		var email = document.querySelector('#email');
		var phone = document.querySelector('#phone');
		var pwrButton = document.querySelector('.forgotLink');
		var pwrBubble = document.querySelector('.forgotLink .bubble-tooltip');
		var btnActions = document.querySelector('.actions');
		var switchToPhoneDiv = document.querySelector('#loginWithPhoneOption');
		var switchToEmailDiv = document.querySelector('#loginWithEmailOption');
		var phonePasswordEnabled = $('body').data('phonePasswordEnabled');
		var phonePinEnabled = $('body').data('phonePinEnabled');
		var signUpLinkOnEmail = document.querySelector('#signUpLinkOnEmail');
		var signUpLinkOnPassword = document.querySelector('#signUpLinkOnPassword');

		if (model.splitLoginContext === 'inputEmail' || model.splitLoginContext === 'inputPhone') {
			splitEmailAndPhoneDom && $(splitEmailAndPhoneDom).removeClass('hide');
			if (rememberProfileDom && typeof model.rememberProfile !== 'undefined') {
				rememberProfileDom.checked = model.rememberProfile === 'true' || model.rememberProfile === true;
			}
			instrumentFirstSplitPageRendered();
			signUpLinkOnEmail && $(signUpLinkOnEmail).removeClass('hide');
			signUpLinkOnPassword && $(signUpLinkOnPassword).addClass('hide');
		} else {
			// Do not change views behind spinner when auto-triggering PN
			if (model.tpdVariant !== 'autoSend') {
				splitEmailAndPhoneDom && $(splitEmailAndPhoneDom).addClass('hide');
			}
			phone && phone.blur();
			email && email.blur();
		}

		if (splitEmailSection && model.splitLoginContext === 'inputEmail') {
			$(splitEmailSection).removeClass('hide');
			email.removeAttribute('disabled');
			if (phonePinEnabled || phonePasswordEnabled) {
				switchToPhoneDiv && $(switchToPhoneDiv).removeClass('hide');
				switchToEmailDiv && $(switchToEmailDiv).addClass('hide');
				pwrButton && $(pwrButton).addClass('hide');
				pwrBubble && $(pwrBubble).addClass('hide');
			} else {
				pwrButton && $(pwrButton).removeClass('hide');
			}
			$(btnActions).removeClass('phonePresent');
			// Disable phone
			if (splitPhoneSection) {
				$(splitPhoneSection).addClass('hide');
			}
			if (phone) {
				phone.value = '';
				phone.setAttribute('disabled', 'disabled');
			}
		}

		if (splitPhoneSection && model.splitLoginContext === 'inputPhone') {
			splitEmailSection && $(splitEmailSection).addClass('hide');
			$(splitPhoneSection).removeClass('hide');
			if (phonePinEnabled || phonePasswordEnabled) {
				switchToPhoneDiv && $(switchToPhoneDiv).addClass('hide');
				switchToEmailDiv && $(switchToEmailDiv).removeClass('hide');
			}
		}
		login.geoEnablement && login.geoEnablement.setGeoMessage(model);
	}

	function setSmartLockView(model) {
		// Early return if smartlock is not enabled
		if (!model.enableSmartlock) {
			return;
		}
		// Call smartLock handler
		login.smartLock(model);
	}

	function setSiAppleView(model) {
		model = model || {};
		var appleIdpJson = model.appleIdpJson;
		if (typeof appleIdpJson !== 'string' || typeof login.siapple !== 'function') {
			return;
		}
		return login.siapple({
			appleIdpJson: appleIdpJson
		});
	}

	function updatePinView(model) {
		var retiringPhonePinMessage = document.querySelector('.educationMessage');
		if (model.showEducationMessage === true && model.splitLoginContext === 'inputPin') {
			retiringPhonePinMessage && $(retiringPhonePinMessage).removeClass('hide');
		} else {
			retiringPhonePinMessage && $(retiringPhonePinMessage).addClass('hide');
		}
	}

	function updatePasswordView(model) {
		var splitPasswordAndPinDom = document.querySelector('#splitPassword');
		var splitPasswordSection = document.querySelector('#splitPasswordSection');
		var splitPinSection = document.querySelector('#splitPinSection');
		var passwordField = document.querySelector('#password');
		var pinField = document.querySelector('#pin');
		var rememberProfileDom = document.querySelector('#rememberProfilePassword');
		var pwrButton = document.querySelector('.forgotLink');
		var phoneField = document.querySelector('#phone');
		var signUpLinkOnEmail = document.querySelector('#signUpLinkOnEmail');
		var signUpLinkOnPassword = document.querySelector('#signUpLinkOnPassword');
		// HACK TO SOLVE PASSWORD PREFILL WHENCE CAPTCHA UNTIL INTEGRATION WITH RATELIMITER3
		/*
		* START OF HACK
		*/
		var passwordFieldWhenCaptcha = document.querySelector('#splitEmail input[type="password"]');

		if (passwordFieldWhenCaptcha && passwordFieldWhenCaptcha.value.trim()) {
			passwordField.value = passwordFieldWhenCaptcha.value;
			passwordFieldWhenCaptcha.value = '';
		}
		/*
		* END OF HACK
		*/

		if (model.splitLoginContext === 'inputPassword' || model.splitLoginContext === 'inputPin') {
			if (splitPasswordAndPinDom && model.tpdVariant !== 'autoSend') {
				// Do not change views behind spinner when auto-triggering PN
				$(splitPasswordAndPinDom).removeClass('hide');
			}

			// TODO: Figure out how to resolve the conflict between SiApple and Smartlock
			setSiAppleView(model);
			setSmartLockView(model);

			if (rememberProfileDom) {
				rememberProfileDom.checked = model.rememberProfile === 'true' || model.rememberProfile === true;
			}
			// show PWR only when phonePassword enabled and it is password field to be displayed
			if (model.splitLoginContext === 'inputPassword' && !model.tpdVariant) {
				pwrButton && $(pwrButton).removeClass('hide');
			}

			if (typeof model.appleIdpJson === 'string') {
				login.utils.addHiddenElement('appleIdpJson', model.appleIdpJson, document.querySelector('form[name=login]'));
			}

			if ($(passwordField).attr('disabled') === 'disabled') {
				passwordField.removeAttribute('disabled');
			}

			// Do not log "password page rendered" when other pages take over
			if (model.smartlockStatus !== 'linked' && !model.verification) {
				instrumentSplitPasswordRendered(model);
			}
			signUpLinkOnEmail && $(signUpLinkOnEmail).addClass('hide');
			signUpLinkOnPassword && $(signUpLinkOnPassword).removeClass('hide');

			// displace footer
			window.dispatchEvent && window.dispatchEvent(createNewEvent('resize'));
		} else {
			splitPasswordAndPinDom && $(splitPasswordAndPinDom).addClass('hide');
			passwordField.value = '';
			if (pinField) {
				pinField.value = '';
			}
		}

		if (splitPasswordSection && model.splitLoginContext === 'inputPassword') {
			splitPinSection && $(splitPinSection).addClass('hide');
			$(splitPasswordSection).removeClass('hide');
		}

		if (splitPinSection && model.splitLoginContext === 'inputPin') {
			$(splitPasswordSection).addClass('hide');
			$(splitPinSection).removeClass('hide');
		}
		// set the phone from profile in the field as well.
		if (model.profile && model.profile.phone && phoneField) {
			phoneField.value = model.profile.phone;
		}
		$('body').hasClass('desktop') && passwordField.focus();
	}

	function updateProfileView(model) {
		var splitLoginContext = document.querySelector('input[name=splitLoginContext]');
		var profileDisplayEmail = document.querySelector('.profileDisplayEmail');
		var profileDisplayName = document.querySelector('.profileDisplayName');
		var profileRememberedEmail = document.querySelector('.profileRememberedEmail');
		var profileIcon = document.querySelector('.profileIcon');
		var email = document.querySelector('#email');
		var profileDisplayPhoneCode = document.querySelector('.profileDisplayPhoneCode');
		var displayEmailPhone;

		// Do not change views behind spinner when auto-triggering PN
		if (model.tpdVariant === 'autoSend') {
			return;
		}

		if (!model.profile) {
			if (profileIcon) {
				// Hide profileIcon
				$(profileIcon).addClass('hide');
				// Empty profileIcon contents if any
				$(profileIcon).text('');
				// Get rid of any style
				profileIcon.removeAttribute('style');
				// Get rid off any profile image
				$(profileIcon).removeClass('profilePhoto');
				// Get rid off any initials
				$(profileIcon).removeClass('profileInitials');
				// Add placeholder image profilePlaceHolderImg
				$(profileIcon).addClass('profilePlaceHolderImg');
			}
			// Remove profileDisplayName
			profileDisplayEmail && $(profileDisplayEmail).text('');
			// Remove profileDisplayPhoneCode
			profileDisplayPhoneCode && $(profileDisplayPhoneCode).text('');
			profileDisplayName && $(profileDisplayName).addClass('hide');
			// Remove any email
			email.value = '';
			// Hide container
			profileRememberedEmail && $(profileRememberedEmail).addClass('hide');
			// Displace footer
			window.dispatchEvent && window.dispatchEvent(createNewEvent('resize'));
			return;
		}

		// Profile with email pr phone is to be ignored in case of email or phone page
		displayEmailPhone = model.profile.phone || model.profile.email;
		if (displayEmailPhone && model.splitLoginContext !== 'inputEmail' && model.splitLoginContext !== 'inputPhone') {
			// update display email
			profileDisplayEmail && $(profileDisplayEmail).text(displayEmailPhone);
			// show display email/phone & not you container
			profileRememberedEmail && $(profileRememberedEmail).removeClass('hide');
		}

		if (model.profile.phoneCode && profileDisplayPhoneCode) {
			$(profileDisplayPhoneCode).text(model.profile.phoneCode);
		}
	};

	function updateSignupView(model) {

		// Update ulPage param in signup link only if there is a value set to such param
		// This behavior currently applies only for Account Match flow (accNoMatch = 'redirect')
		function updateHref(url, newVal) {
			var currentVal = login.utils.getQueryParamFromUrl('ulPage', url);
			if (currentVal) {
				return login.utils.updateParamValue(url, 'ulPage', newVal);
			}

			// Return current URL value if ulPage value not updated
			return url;
		}

		var $signupContainer = $(document.querySelector('#signupContainer'));
		var isEmailPage = model.splitLoginContext === 'inputEmail' ||
			model.splitLoginContext === 'inputPhone';
		var isGuestEscapeHatch = model.contextualLogin && model.contextualLogin.guestEscapeHatch;
		var isOtpSmsUser = model.isOtpSmsUser;
		var hideSignupOnEmailPage, hideSignupOnPasswordPage,
			$signupLink, href;

		if (!$signupContainer) {
			return;
		}
		$signupLink = $(signupContainer.querySelector('#createAccount'));

		hideSignupOnEmailPage = $signupContainer.data('hideOnEmail') === 'true' || isGuestEscapeHatch || isOtpSmsUser;
		hideSignupOnPasswordPage = $signupContainer.data('hideOnPass') === 'true';
		href = $signupLink && $signupLink.attr('href');

		// On email page
		if (isEmailPage) {
			if (hideSignupOnEmailPage) {
				$signupContainer.addClass('hide');
			} else {
				$signupContainer.removeClass('hide');
			}
			$signupLink && $signupLink.attr('href', updateHref(href, 'email'));
		// On Password page
		} else {
			// In in any xhr the response is to hide sign up
			if (hideSignupOnPasswordPage) {
				$signupContainer.addClass('hide');
			} else {
				$signupContainer.removeClass('hide');
			}
			$signupLink && $signupLink.attr('href', updateHref(href, 'pwd'));
		}
	}

	function updateVerificationView(model) {
		var footer = document.querySelector('footer');
		var loginSection = document.querySelector('#login');
		var loginContentContainer = document.querySelector('#login .contentContainer');
		var verificationContentContainer = document.querySelector('#verification .contentContainer');
		var verificationSection = document.querySelector('#verification');
		var activeContent;
		if (model.verification) {
			activeContent = document.querySelector('.activeContent');
			$(loginSection).addClass('hide');
			$(verificationSection) && $(verificationSection).removeClass('hide');
			$(footer).addClass('footerWithIcon');
			$(activeContent).removeClass('activeContent');
			// Required for displacing footer on window.resize
			$(verificationContentContainer) && $(verificationContentContainer).addClass('activeContent');
			updatePendingView(model.verification);
			login.tpdLogin && login.tpdLogin.instrumentVerificationViewRendered();
		} else {
			activeContent = document.querySelector('.activeContent');
			$(loginSection).removeClass('hide');
			$(verificationSection) && $(verificationSection).addClass('hide');
			$(footer).removeClass('footerWithIcon');
			$(activeContent).removeClass('activeContent');
			$(loginContentContainer).addClass('activeContent');  // Required for displacing footer on window.resize
		}
	}

	function updatePendingView(verificationModel) {
		if (!verificationModel) {
			return;
		}

		var account = document.querySelector('.account');
		var pin = document.querySelector('.mobileNotification .pin');
		var twoDigitPin = document.querySelector('.twoDigitPin');
		var uncookiedMessage = document.querySelector('#uncookiedMessage');
		var cookiedMessage = document.querySelector('#cookiedMessage');
		$(account).text(verificationModel.email);
		if (verificationModel.pin && pin) {
			$(pin).text(verificationModel.pin);
			$(twoDigitPin).text(verificationModel.pin);
			twoDigitPin.setAttribute('style', 'font-weight: bold');
			$(uncookiedMessage).removeClass('hide');
		} else {
			$(cookiedMessage).removeClass('hide');
		}
	};

	function updateNotificationView(model) {
		var notifications = document.querySelectorAll('.notifications');
		var isOtpSmsUser = model.isOtpSmsUser;
		// Empty notifications by default
		// TODO: Fix this multiple notifications maintenance
		for (var i = 0; i < notifications.length; i++) {
			$(notifications[i]).text('');
			if (model.notifications && model.notifications.msg) {
				notifications[i].innerHTML = '<p class="notification ' +
					model.notifications.type + '" role="alert">' + model.notifications.msg + '</p>';
			}
		}
		if(model.notifications && isOtpSmsUser) {
			login.utils.hideSpinner();
		}
	}

	function updateSubHeaderView(model) {
		// Toggle email and password sub header
		var emailSubTagLine = document.querySelector('#emailSubTagLine');
		var phoneSubTagLine = document.querySelector('#phoneSubTagLine');
		var pwdSubTagLine = document.querySelector('#pwdSubTagLine');
		var pwdSecondarySubTagLine = document.querySelector('#pwdSecondarySubTagLine');

		if (model.splitLoginContext === 'inputPassword' || model.splitLoginContext === 'inputPin') {
			emailSubTagLine && $(emailSubTagLine).addClass('hide');
			phoneSubTagLine && $(phoneSubTagLine).addClass('hide');
			pwdSubTagLine && $(pwdSubTagLine).removeClass('hide');
			pwdSecondarySubTagLine && $(pwdSecondarySubTagLine).removeClass('hide');
		} else if (model.splitLoginContext === 'inputPhone') {
			// if landed in splitPhone page show the phone sub tag and hide email sub tag
			phoneSubTagLine && $(phoneSubTagLine).removeClass('hide');
			emailSubTagLine && $(emailSubTagLine).addClass('hide');
			pwdSubTagLine && $(pwdSubTagLine).addClass('hide');
			pwdSecondarySubTagLine && $(pwdSecondarySubTagLine).addClass('hide');
		} else {
			emailSubTagLine && $(emailSubTagLine).removeClass('hide');
			phoneSubTagLine && $(phoneSubTagLine).addClass('hide');
			pwdSubTagLine && $(pwdSubTagLine).addClass('hide');
			pwdSecondarySubTagLine && $(pwdSecondarySubTagLine).addClass('hide');
		}
	};
	// TODO: Move this (and all randomly sprinkled metrics calls) to a separate file and use with pubsub to trigger it
	function instrumentFirstSplitPageRendered() {
		var isHybrid = login.utils.isHybridLoginExperience();
		login.logger.log({
			evt: 'state_name',
			data: isHybrid ? 'begin_hybrid_login' : 'begin_email',
			instrument: true
		});
		login.logger.log({
			evt: 'transition_name',
			data: isHybrid ? 'prepare_hybrid' : 'prepare_email',
			instrument: true
		});
		login.logger.log({
			evt: 'is_cookied',
			data: 'N',
			instrument: true
		});
		login.logger.pushLogs();
	}

	function instrumentSplitPasswordRendered(model) {
		var passwordField = document.querySelector('#password');
		var phoneField = document.querySelector('#phone');
		var isPasswordAutofilled = login.utils.isFieldPrefilled(passwordField);
		var isHybrid = login.utils.isHybridLoginExperience();
		var transitionName = isHybrid ? 'prepare_hybrid_pwd' : 'prepare_pwd';
		transitionName += (login.utils.getKmliCb() ? '_ot' : '');

		if (document.querySelector('#moreOptionsContainer') && model.moreOptions === true) {
			transitionName = transitionName + '_more_opt';
			login.logger.log({
				evt: 'exp_shown',
				data: 'tpd',
				instrument: true
			});
		}

		login.logger.log({
			evt: 'state_name',
			data: isHybrid ? 'begin_hybrid_pwd' : 'begin_pwd',
			instrument: true
		});
		login.logger.log({
			evt: 'pub_cred_type',
			data: (phoneField && phoneField.value) ? 'phone' : 'email',
			instrument: true
		});
		login.logger.log({
			evt: 'transition_name',
			// Append `_ot` only if One Touch (KMLI) checkbox is enabled for this request
			data: transitionName,
			instrument: true
		});
		login.logger.log({
			evt: 'is_cookied',
			data: 'Y',
			instrument: true
		});
		login.logger.log({
			evt: 'autofill',
			data: isPasswordAutofilled ? 'Y' : 'N',
			instrument: true
		});
		login.logger.pushLogs();
	}

	function updateCaptchaDom(model) {
		var captchaDom;

		function changeVisibility(makeVisible) {
			var captchaContainers = document.querySelectorAll('.captcha-container');
			for (var i = 0; i < captchaContainers.length; i++) {
				if (makeVisible) {
					$(captchaContainers[i]).removeClass('hide');
				} else {
					// Make inivisble
					$(captchaContainers[i]).addClass('hide');
				}
			}
		}

		changeVisibility(model.captcha);

		if (!model.captcha) {
			return;
		}

		captchaDom = login.utils.getActiveCaptchaElement({value: model.splitLoginContext});
		if (!captchaDom) {
			return;
		}

		if (model.captcha.captchaImgUrl && captchaDom.image) {
			captchaDom.image.setAttribute('src', model.captcha.captchaImgUrl);
		}

		if (model.captcha.captchaAudioUrl && captchaDom.audioTag) {
			captchaDom.audioTag.setAttribute('src', model.captcha.captchaAudioUrl);
		}

		if (model.captcha.captchaAudioUrl && captchaDom.audioLink) {
			captchaDom.audioLink.setAttribute('href', model.captcha.captchaAudioUrl);
		}
	}

	function updateViewAfterAds(model) {
		if (!model.adsChallengeVerified) {
			return;
		}

		// ADS captcha was verified so we have to toggle back the DOM
		$('#login').removeClass('hide');

		if (document.getElementById('ads-container')) {
			document.getElementById('ads-container').style.display = 'none';
		}
	}

	// Initialize store as a global variable and subscribe to state updates
	login.storeInstance = login.store();
	login.pubsub.subscribe('STATE_UPDATED', render);

	return {
		render: render,
		updateNotificationView: updateNotificationView
	};
}());

(function() {
	if (typeof Object.assign !== 'function') {
		Object.assign = function(target, varArgs) { // .length of function is 2
			'use strict';
			if (target === null) { // TypeError if undefined or null
				throw new TypeError('Cannot convert undefined or null to object');
			}

			var to = Object(target);

			for (var i = 1; i < arguments.length; i++) {
				var nextSource = arguments[i];

				if (nextSource !== null) { // Skip over if undefined or null
					for (var nextKey in nextSource) {
						// Avoid bugs when hasOwnProperty is shadowed
						if (Object.prototype.hasOwnProperty.call(nextSource, nextKey)) {
							to[nextKey] = nextSource[nextKey];
						}
					}
				}
			}
			return to;
		}
	}

	if (!String.prototype.trim) {
		String.prototype.trim = function() {
			return this.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '');
		};
	}
}());

// FRAUDNET
login.fn = (function() {
	'use strict';

	// This will not and cannot ever change.
	var fncls = 'fnparams-dede7cc5-15fd-4c75-a9f4-36c430ee3a99';

	function _injectConfig(options) {
		var script = document.getElementById('fconfig');

		if (script) {
			if (script.parentNode) {
				script.parentNode.removeChild(script);
			}
		}

		script = document.createElement('script');
		script.id = 'fconfig';
		script.type = 'application/json';
		script.setAttribute('fncls', fncls);
		script.setAttribute('nonce', $('body').data('nonce'));
		var configuration = {
			f: options.fnSessionId,
			s: options.sourceId,
			b: options.beaconUrl,
			ts: {
				type: 'UL',
				fields: [
					{id: 'email', min: 6},
					{id: 'password', min: 6}
				],
				delegate: false
			}
		};
		script.text = JSON.stringify(configuration);
		document.body.appendChild(script);
	}

	function _loadBeaconJS(options) {
		var script = document.createElement('script');
		script.src = options.fnUrl;
		script.onload = function() {
			_enableSpeedTyping(options);
		};
		document.body.appendChild(script);
	}

	function _enableSpeedTyping(options) {
		if (options.enableSpeedTyping && typeof initTsFb === 'function') {
			initTsFb({
				detail: {
					type: 'UL',
					fields: ['email', 'password']
				}
			});
		}
	}

	/**
	 * Collects fraudnet telemetry & checksum data using the inlined fnsync script file
	 * @param {Object} options
	 */
	function initializeFnSync(options) {
		if (PAYPAL.syncData && typeof PAYPAL.syncData.initSync === 'function' && options) {
			options.detail = {
				type: 'UL',
				fields: ['email', 'password']
			};
			PAYPAL.syncData.initSync(options);
		}
	}

	/**
	 * Adds the collected the fraudnet sync data to the hidden form input
	 */
	function addFnSyncData() {
		if (PAYPAL.syncData && typeof PAYPAL.syncData.flushData === 'function') {
			try {
				PAYPAL.syncData.flushData();
			} catch (e) {}
		} else {
			login.logger.log({
				evt: 'FN_PAYLOAD',
				data: 'fn_sync_data_not_load',
				instrument: true
			});
			login.logger.pushLogs();
		}
	}

	/**
	 * Uses the updated source ID from each XHR call on any view change to collect sync again
	 * @param {Object} data
	 */
	function updateFnSyncContext(data) {
		if (data && data.sourceId && typeof PAYPAL.ulSync === 'object') {
			PAYPAL.ulSync.sourceId = data.sourceId;
			initializeFnSync(PAYPAL.ulSync);
		}
	}

	/**
	 * Check to initiate fn on web view
	 */
	function isWebViewSupported() {
		var enableFnBeaconOnWebViews = $('body').data('enableFnBeaconOnWebViews');

		if (!enableFnBeaconOnWebViews &&
			(/(iPhone|iPod|iPad).*AppleWebKit(?!.*Safari)/i).test(window.navigator.userAgent)) {
			return false;
		}

		return true;
	}

	function initialize() {
		// Trigger fraudnet beacon (only if not in web view)
		if (isWebViewSupported() && PAYPAL && PAYPAL.ulData && PAYPAL.ulData.fnUrl) {
			_injectConfig(PAYPAL.ulData);
			_loadBeaconJS(PAYPAL.ulData);
		}
		initializeFnSync(PAYPAL.ulSync);
	}

	return {
		initialize: initialize,
		initializeFnSync: initializeFnSync,
		addFnSyncData: addFnSyncData,
		updateFnSyncContext: updateFnSyncContext
	}
}());

login.qrCode = (function(){
	login.ref_str = $('body').data('ref_str');
	login.qrImageUrl = '';
	var refreshIcon = document.querySelector('#refreshIcon');
	var refreshMessage = document.querySelector('#refreshMessage');
	var refreshComponent = document.querySelector('#refreshComponent');
	function refreshClickHandler(event){
		eventPreventDefault(event);
		var qrcSpinnerContainer = document.querySelector('#qrcSpinnerContainer');
		$(qrcSpinnerContainer).removeClass('hide');
		$(refreshComponent).addClass('hide');
		login.logger.log({
			evt: 'QRC',
			data: 'QRC_CLICK_REFRESH',
			calEvent: true
		});
		login.logger.log({
			evt: 'qrc_reason',
			data: 'qrc_click_refresh',
			instrument: true
		});
		login.logger.log({
			evt: 'qr_context_id',
			data: login.ref_str,
			instrument: true
		});
		login.logger.pushLogs();
		login.fn.addFnSyncData();
		$.ajax({
			type: 'POST',
			url: '/signin/qrc/manage',
			data: {
				'_csrf': login.utils.getCSRFToken(),
				fnId: PAYPAL.ulData && PAYPAL.ulData.fnSessionId,
				fn_sync_data: document.querySelector('input[name="fn_sync_data"]').value,
				ref_str: login.ref_str,
				qrcOperation: 'refresh'
			},
			onErrorEnabled: true,
			timeoutEnable: true,
			success: function(res){
				$(qrcSpinnerContainer).addClass('hide');
				login.ref_str = res.ref_str;
				login.qrImageUrl = res.qrImageUrl;
				login.logger.log({
					evt: 'QRC',
					data: 'QRC_REFRESH_SUCCESS',
					calEvent: true,
					status: 'SUCCESS'
				});
				login.logger.log({
					evt: 'qrc_reason',
					data: 'qrc_refresh_success',
					instrument: true
				});
				login.logger.log({
					evt: 'qr_context_id',
					data: login.ref_str,
					instrument: true
				});
				login.logger.pushLogs();
				initialize({refreshFlow: true});
			},
			fail: function(e){
				login.logger.log({
					evt: 'QRC',
					data: 'QRC_REFRESH_FAILED',
					calEvent: true,
					status: 'ERROR'
				});
				login.logger.log({
					evt: 'qrc_reason',
					data: 'qrc_refresh_failed',
					instrument: true
				});
				login.logger.log({
					evt: 'qr_context_id',
					data: login.ref_str,
					instrument: true
				});
				login.logger.pushLogs();
				$(qrcSpinnerContainer).addClass('hide');
				$(refreshComponent).removeClass('hide');
			}
		});
	}
	if (refreshIcon) {
		addEvent(refreshIcon, 'click', function(event) {
			eventPreventDefault(event);
			refreshClickHandler(event);
		});
	}
	if (refreshMessage) {
		addEvent(refreshMessage, 'click', function(event) {
			eventPreventDefault(event);
			refreshClickHandler(event);
		});
	}
	function initialize(props){
		props = props || {};
		if (!login.ref_str) {
			return;
		}

		try {
			window.localStorage.setItem('ref_str', login.ref_str);
		} catch(e) {
			login.logger.log({
				evt: 'localStorage not supported',
				data: e,
				calEvent: true,
				status: 'ERROR'
			});
			login.logger.pushLogs();
		}

		login.logger.log({
			evt: 'QRC',
			data: 'QRC_GENERATE_SUCCESS',
			calEvent: true
		});
		login.logger.log({
			evt: 'state_name',
			data: 'qrc',
			instrument: true
		});
		login.logger.log({
			evt: 'transition_name',
			data: 'process_qrc_generate_success',
			instrument: true
		});
		login.logger.log({
			evt: 'qr_context_id',
			data: login.ref_str,
			instrument: true
		});
		login.logger.pushLogs();

		var qrcSpinnerContainer = document.getElementById("qrcSpinnerContainer");
		$(qrcSpinnerContainer) && $(qrcSpinnerContainer).addClass('hide');
		var qrPPLogo = document.getElementById("qrPPLogo");
		$(qrPPLogo) && $(qrPPLogo).removeClass('hide');
		login.fn.addFnSyncData();

		if (!props.refreshFlow) {
			$.ajax({
				url: '/signin/qrc/manage',
				method: 'POST',
				data: {
					'_csrf': login.utils.getCSRFToken(),
					fnId: PAYPAL.ulData && PAYPAL.ulData.fnSessionId,
					fn_sync_data: document.querySelector('input[name="fn_sync_data"]').value,
					ref_str: login.ref_str,
					qrcOperation: 'update'
				},
				onErrorEnabled: true,
				timeoutEnable: true,
				success: function(res) {
					login.logger.log({
						evt: 'QRC',
						data: 'QRC_UPDATE_SUCCESS',
						calEvent: true
					});
					login.logger.log({
						evt: 'state_name',
						data: 'qrc',
						instrument: true
					});
					login.logger.log({
						evt: 'transition_name',
						data: 'process_qrc_update_success',
						instrument: true
					});
					login.logger.log({
						evt: 'qr_context_id',
						data: login.ref_str,
						instrument: true
					});
					login.logger.pushLogs();
					login.qrcPolling.startPolling();
				},
				fail: function(e) {
					login.logger.log({
						evt: 'QRC',
						data: 'QRC_UPDATE_ERROR',
						calEvent: true,
						status: 'ERROR'
					});
					login.logger.log({
						evt: 'qrc_reason',
						data: 'qrc_update_error',
						instrument: true
					});
					login.logger.log({
						evt: 'qr_context_id',
						data: login.ref_str,
						instrument: true
					});
					login.logger.pushLogs();
					$(qrcSpinnerContainer).addClass('hide');
					$(refreshComponent).removeClass('hide');
				}
			});
		}
		if (props.refreshFlow) {
			qrcServRender();
		}
	}

	function qrcServRender () {
		var qrImg = document.querySelector('#qrcCanvas > img');
		if (qrImg) {
			qrImg.remove();
		}
		qrImg = document.createElement("IMG");
		qrImg.src = login.qrImageUrl;
		document.getElementById("qrcCanvas").appendChild(qrImg);
		login.logger.log({
			evt: 'QRC',
			data: 'QRC_SERV_RENDER_SUCCESS',
			calEvent: true
		});
		login.logger.log({
			evt: 'state_name',
			data: 'qrc',
			instrument: true
		});
		login.logger.log({
			evt: 'transition_name',
			data: 'process_qrc_server_render_success',
			instrument: true
		});
		login.logger.log({
			evt: 'qr_context_id',
			data: login.ref_str,
			instrument: true
		});
		login.logger.pushLogs();
		login.qrcPolling.startPolling({refreshFlow:true});
	}

	return {
		initialize: initialize
	}
}());

login.qrcPolling = (function() {
	var isPolling=true;
	var refreshComponent = document.querySelector('#refreshComponent');
	var pollTimeInterval = parseInt($('body').data('pollTimeInterval'));
	function startPolling(props) {
		props = props || {};
		if(props.refreshFlow) {
			isPolling = true;
		}
		try {
			var localKey = window.localStorage.getItem('ref_str');
		} catch(e) {
			login.logger.log({
				evt: 'localStorage not supported',
				data: e,
				calEvent: true,
				status: 'ERROR'
			});
			login.logger.pushLogs();
		}

		if (!login.ref_str || login.ref_str !== localKey) {
			isPolling = false;
			$(refreshComponent).removeClass('hide');
			if (login.ref_str !== localKey) {
				login.logger.log({
					evt: 'QRC',
					data: 'QRC_MULTI_TABS',
					calEvent: true
				});
				login.logger.log({
					evt: 'qrc_reason',
					data: 'qrc_multi_tabs'+ + $('body').data('loginPollCounter'),
					instrument: true
				});
				login.logger.log({
					evt: 'qr_context_id',
					data: login.ref_str,
					instrument: true
				});
				login.logger.pushLogs();
			}
			$.ajax({
				url: '/signin/qrc/manage',
				method: 'POST',
				data: {
					'_csrf': login.utils.getCSRFToken(),
					ref_str: login.ref_str,
					intent: login.utils.getIntent(),
					qrcOperation: 'destroy'
				}
			});
			return;
		}
		if (isPolling) {
			setTimeout(() => {
				polling();
			}, pollTimeInterval);
		}
	}

	function polling() {
		var qrcSpinnerContainer = document.querySelector('#qrcSpinnerContainer');

		$.ajax({
			url: '/signin/qrc/manage',
			method: 'POST',
			data: {
				'_csrf': login.utils.getCSRFToken(),
				ref_str: login.ref_str,
				intent: login.utils.getIntent(),
				qrcOperation: 'validate'
			},
			onErrorEnabled: true,
			timeoutEnable: true,
			success: function(res) {
				if (res.qrcStatus === 'POLLING_IN_PROGRESS'){
					startPolling();
				}
				if(res.qrcStatus === 'SUCCESS'){
					login.utils.showSpinner({ qrCodeSpinner: true });
					login.utils.showSpinnerMessage('qrcMessage');
					login.logger.log({
						evt: 'QRC',
						data: 'QRC_VERIFY_SUCCESSFUL',
						calEvent: true,
						status: 'SUCCESS'
					});
					login.logger.log({
						evt: 'qrc_reason',
						data: 'process_qrc_verify' + $('body').data('loginPollCounter'),
						instrument: true
					});
					login.logger.log({
						evt: 'qrc_count',
						data: $('body').data('loginPollCounter'),
						instrument: true
					});
					login.logger.log({
						evt: 'qr_context_id',
						data: login.ref_str,
						instrument: true
					});
					login.logger.pushLogs();
					window.location.href = res.returnUrl;
				}
			},
			fail: function(e) {
				login.logger.log({
					evt: 'QRC',
					data: 'QRC_VERIFY_FAILED',
					calEvent: true,
					status: 'ERROR'
				});
				login.logger.log({
					evt: 'qrc_reason',
					data: 'process_qrc_verify_failed',
					instrument: true
				});
				login.logger.log({
					evt: 'qr_context_id',
					data: login.ref_str,
					instrument: true
				});
				login.logger.pushLogs();
				$(qrcSpinnerContainer).addClass('hide');
				$(refreshComponent).removeClass('hide');
			}
		});
	}
	return {
		startPolling
	}
}());

login.verification = (function() {
	var maxPollAttempts = 9;
	var count = 0;
	var showResendLinkDelay = 5000;
	var unhideResendLinkDelay = 3000;
	var maxResendAttempts = 3;
	var resendCount = 0;
	var csrfField = document.querySelector('input[name=_csrf]');
	var localeField = document.querySelector('input[name="locale.x"]');
	var activeXhr;
	var isPolling = false;
	var accessToken, authflowDocumentId, email;
	var verificationSection = document.querySelector('#verification');
	var verificationSubSection = document.querySelector('.verificationSubSection');
	var expiredSubSection = document.querySelector('#expired');
	var deniedSubSection = document.querySelector('#denied');
	var expiredTryAgainButton = document.querySelector('#expiredTryAgainButton');
	var pendingNotYouLink = document.querySelector('#pendingNotYouLink');
	var tryPasswordLink = document.querySelector('#pending #tryPasswordLink');
	var resendLink = document.querySelector('#resend');
	var sentMessage = document.querySelector('.sentMessage');
	var passwordInsteadDropDown = document.querySelector('#passwordInsteadDropDown');
	var passwordInsteadGroup = document.querySelector('#passwordInsteadGroup');
	var loginSection = document.querySelector('#login');
	var tpdExperience, pnApprove, tpdTriggerMethod;

	var pollingXhrSuccessHandler = function(response) {
		if (!response) {
			poll();
		}

		// Update CSRF
		csrfField.value = response._csrf || csrfField.value;
		switch (response.pollStatus) {
			case 'Accepted':
				stopPolling();
				pnApprove = pnApprove ? false : response.pollStatus === 'Accepted';
				if (pnApprove) {
					login.logger.log({
						evt: 'TPD_CLIENT',
						data: 'Approved_' + response.tpdTriggerMethod,
						calEvent: true
					});
					login.logger.pushLogs();
				}
				// last login call
				completeLogin();
				break;

			case 'Downgraded':
				// pending
				poll();
				break;

			case 'Denied':
				stopPolling();
				$(verificationSubSection).addClass('hide');
				$(deniedSubSection).removeClass('hide');
				break;

			case 'Failed':
				stopPolling();
				// Show inputPassword section with notification
				showPasswordView(response);
				break;

			default:
				// Error
				if (response.errorView) {
					showExpiredView();
					login.tpdLogin.instrumentTpdExpired('RCS_SERVICE_ERROR');
				} else {
					poll();
				}
				break;
		}
	};

	function showPasswordView(response) {
		login.utils.updateView({
			splitLoginContext: 'inputPassword',
			profile: {
				email: email
			},
			verification: null,
			notifications: response.notifications
		});
	}
	function showExpiredView() {
		var expiredNotification;
		var expiredMsg = document.querySelector('#expired .slimP');
		if (expiredMsg && expiredMsg.textContent) {
			expiredNotification = {
				msg: expiredMsg && expiredMsg.textContent,
				type: 'notification-warning'
			};
		}
		login.utils.updateView({
			splitLoginContext: 'inputPassword',
			profile: {
				email: email
			},
			tpdVariant: tpdExperience,
			verification: null,
			ulSync: getFnSourceId('inputPassword'),
			notifications: expiredNotification
		});
	}
	function getFnSyncData() {
		if (PAYPAL.syncData && typeof PAYPAL.syncData.data === 'object') {
			return JSON.stringify(PAYPAL.syncData.data);
		}
	}

	function getFnSourceId(context) {
		var sourceId = PAYPAL.ulSync && PAYPAL.ulSync.sourceId || '';
		var remembered = sourceId.indexOf('REMEMBERED') !== -1 ? '_REMEMBERED' : '';
		var fnContext = {
			'inputPassword': 'UNIFIED_LOGIN_INPUT_PASSWORD'
		};

		return {
			sourceId: fnContext[context] + remembered
		};
	}

	function completeLogin() {
		var rememberProfile = login.storeInstance.getState().model.rememberProfile;
		var data = {
			_csrf: csrfField.value,
			intent: 'completeLogin',
			accessToken: accessToken,
			'locale.x': localeField.value,
			rememberProfile: rememberProfile === 'true' || rememberProfile === true,
			// Send login_email in order to have it in account details to be able to drop RMUC for TPD
			login_email: email,
			flowId: login.utils.getFlowId(),
			tpdVariant: tpdExperience,
			tpdTriggerMethod: tpdTriggerMethod
		};
		var fnSyncData = getFnSyncData();

		if (fnSyncData) {
			data.fn_sync_data = fnSyncData;
		}

		if (login.utils.getCtxId()) {
			data.ctxId = login.utils.getCtxId();
		}
		$.ajax({
			url: '/signin/challenge/push?intent=' + login.utils.getIntent(),
			type: 'POST',
			data: data,
			success: function(response) {
				if (response && response.pollStatus === 'LoggedIn' && response.returnUrl) {
					return window.location.href = response.returnUrl;
				}

				if (response && response.pollStatus === 'Failed') {
					return showPasswordView(response);
				}
				showExpiredView();
				// No response or an undefined/unrecognized pollStatus
				login.tpdLogin.instrumentTpdExpired('NO_RESPONSE');
			}
		});
	}

	function poll() {
		// exit clauses
		if (!isPolling) {
			return;
		}
		if (count >= maxPollAttempts) {
			// show password page when Push Notification expired
			showExpiredView();
			login.tpdLogin.instrumentTpdExpired('NO_ACTION');
			return;
		}
		// stop polling from external code

		// update counter
		count++;
		// make a xhr request to UL server & it responds with :
		activeXhr = $.ajax({
			url: '/signin/challenge/push',
			type: 'POST',
			data: {
				_csrf: csrfField.value,
				intent: 'poll',
				accessToken: accessToken,
				authflowDocumentId: authflowDocumentId,
				retryCount: count,
				'locale.x': localeField.value,
				flowId: login.utils.getFlowId(),
				tpdVariant: tpdExperience,
				tpdTriggerMethod: tpdTriggerMethod
			},
			success: pollingXhrSuccessHandler,
			fail: function() {
				// error (ccp is down, our box goes down, xhr fails/times out)
				if (isPolling) {
					poll();
				}
			}
		});
	}

	function showSurvey(event) {
		event.preventDefault();
		$(passwordInsteadDropDown).removeClass('hide');

	}

	function startPolling(params) {
		var loginForm = document.querySelector('form[name=login]');
		var hiddenElement;
		params = params || {};
		isPolling = true;
		accessToken = params.accessToken || accessToken;
		authflowDocumentId = params.authflowDocumentId || authflowDocumentId;
		email = params.email || email;
		count = 0;
		// override only when params has variant
		tpdExperience = params.variant || tpdExperience;
		tpdTriggerMethod = params.tpdTriggerMethod || tpdTriggerMethod;
		poll();

		// Add docId as hidden element to support TPD automation
		hiddenElement = document.querySelector('[name=authdocId]');
		if (!hiddenElement) {
			login.utils.addHiddenElement('authdocId', authflowDocumentId, loginForm);
		} else {
			hiddenElement.setAttribute('value', authflowDocumentId);
		}
	}

	function expiredTryAgainHandler() {
		window.location.href = window.location.href;
	}

	if (expiredTryAgainButton) {
		expiredTryAgainButton.onclick = expiredTryAgainHandler;
	}

	if (pendingNotYouLink) {
		pendingNotYouLink.onclick = function(event) {
			stopPolling();
			login.tpdLogin.instrumentNotYouClicked();
			login.utils.notYouClickHandler(event);
		};
	}
	function togglePasswordInstead(event) {
		var evtTarget = getEventTarget(event);
		if (!passwordInsteadDropDown) {
			return;
		}
		if ($(evtTarget).hasClass('showSurvey')) {
			return;
		}
		// any other place, hide the dropdown
		$(passwordInsteadDropDown).addClass('hide');
	}

	function usePasswordInstead(event) {
		var tpdEventTarget = getEventTarget(event);
		var reason = $(tpdEventTarget).data('reason');
		event.preventDefault();
		$(resendLink).addClass('hide');
		$(resendLink).removeClass('greyOut');
		stopPolling();
		login.tpdLogin.instrumentUsePasswordInstead(reason);
		if (verificationSection) {
			$(verificationSection).addClass('hide');
		}
		if (loginSection) {
			$(loginSection).removeClass('hide');
		}
	}

	function stopPolling() {
		isPolling = false;
		if (activeXhr) {
			activeXhr.abort();
		}
	}

	function showResendLink() {
		resendCount = 0;
		setTimeout(function() {
			$(resendLink).removeClass('hide');
		}, showResendLinkDelay);
	}

	function resendPushNotification(event) {
		event.preventDefault();
		if ($(event.target).hasClass('greyOut')) {
			return;
		}

		login.tpdLogin.instrumentResendClicked();
		stopPolling();
		// Reset poll counter
		count = 0;
		$(resendLink).addClass('greyOut');
		resendCount++;
		$.ajax({
			url: '/signin/challenge/push',
			type: 'POST',
			data: {
				_csrf: csrfField.value,
				intent: 'resend',
				accessToken: accessToken,
				authflowDocumentId: authflowDocumentId,
				'locale.x': localeField.value,
				flowId: login.utils.getFlowId(),
				tpdVariant: tpdExperience,
				tpdTriggerMethod: tpdTriggerMethod
			},
			success: function resendSuccess(response) {
				if (response && response.resendStatus === 'Success') {
					startPolling({
						accessToken: accessToken,
						authflowDocumentId: authflowDocumentId,
						email: email
					});
					$(resendLink).addClass('hide');
					$(sentMessage).removeClass('hide');
					setTimeout(function() {
						$(sentMessage).addClass('hide');
						if (resendCount < maxResendAttempts) {
							$(resendLink).removeClass('hide');
							$(resendLink).removeClass('greyOut');
						}
					}, unhideResendLinkDelay);
					return;
				}

				if (response && response.notifications) {
					login.view.updateNotificationView(response);
				}
			},
			fail: function noOp() {
			}
		});
	}

	function updateView(model) {
		var moreOptionsContainer = document.querySelector('#moreOptionsContainer');
		var tpdButtonContainer = document.querySelector('#tpdButtonContainer');
		var tpdEligible = document.querySelector('input[name="tpdEligible"]');
		var loginForm = document.querySelector('form[name=login]');
		var tpdEligibleInput;
		var btnNext = document.querySelector('#btnNext');
		// safety check
		if (!model || !tpdButtonContainer || !moreOptionsContainer) {
			return;
		}
		// TODO check why formdata was not set when set in model in xhr response
		if (model.tpdVariant || model.tpdAutoSend) {
			if (tpdEligible) {
				tpdEligible.value = 'true';
			} else {
				tpdEligibleInput = document.createElement('input');
				tpdEligibleInput.setAttribute('type', 'hidden');
				tpdEligibleInput.setAttribute('name', 'tpdEligible');
				tpdEligibleInput.setAttribute('value', 'true');
				$(loginForm).append(tpdEligibleInput);
			}
		}
		if (model.tpdVariant === 'moreOptions') {
			$(moreOptionsContainer).removeClass('hide');
			$('.forgotLink').addClass('hide');
		}
		if (model.tpdVariant === 'tpdButton') {
			$(moreOptionsContainer).addClass('hide');
			$(tpdButtonContainer).removeClass('hide');
			$('.forgotLink').removeClass('hide');
			$('#signupContainer').addClass('hide');
		}
		// Auto send push notification (conditionally)
		if (model.tpdAutoSend) {
			login.tpdLogin && login.tpdLogin.instrumentTpdLoginAutoTriggered();
			login.tpdLogin && login.tpdLogin.attemptTpdLogin('autoSend');
		}
		if (model.splitLoginContext === 'inputEmail') {
			$(moreOptionsContainer).addClass('hide');
			$(tpdButtonContainer).addClass('hide');
			if (tpdEligible && tpdEligible.value === 'true') {
				tpdEligible.value = '';
			}
		}
		// for usePasswordInstead on PN page to go back to password page in demo flow
		if (login.utils.isTpdDemo() && model.splitLoginContext !== 'inputEmail') {
			var splitPasswordSection = document.querySelector('#splitPassword');
			btnNext && $(btnNext).addClass('hide');
			splitPasswordSection && $(splitPasswordSection).removeClass('hide');
		} else {
			// for click change in tpd Demo flow
			btnNext && $(btnNext).removeClass('hide');
		}
	}

	// Attach events
	if (login.pubsub) {
		login.pubsub.subscribe('WINDOW_CLICK', togglePasswordInstead);
	}
	// Attach event to usePasswordInstead Link
	if (tryPasswordLink && $(tryPasswordLink).hasClass('showSurvey')) {
		addEvent(tryPasswordLink, 'click', showSurvey);
		addEvent(passwordInsteadGroup, 'click', usePasswordInstead);
	} else if (tryPasswordLink) {
		addEvent(tryPasswordLink, 'click', usePasswordInstead);
	}
	addEvent(resendLink, 'click', resendPushNotification);

	return {
		startPolling: startPolling,
		showResendLink: showResendLink,
		updateView: updateView
	};

}());

login.overlayUtils = (function() {

	var closeOverlayOnTimeoutFn;

	function oneTouchOverlayOptInClickHandler(event) {
		eventPreventDefault(event);
		clearTimeout(closeOverlayOnTimeoutFn);
		var overlaySpinner = document.getElementById('overlaySpinner');
		var overlaySpinnerSuccess = document.getElementById('overlaySpinnerSuccess');
		var returnUrl = $('body').data('return-url') || '/signin';
		var overlayOptIn = document.getElementById('overlayOptIn');

		// Disable the opt-in button for user to not click again.
		overlayOptIn.disabled = true;
		$(overlaySpinnerSuccess).removeClass('hide');
		$(overlaySpinner).addClass('hide');

		// Close the overlay after a delay which is the time for changing the overlay image
		setTimeout(function() {
			closeOverlay();
		},1300);

		var setIntervalId;
		// Start the OneTouch activation via XHR
		$.ajax({
			type: 'POST',
			url: '/signin/provisionCapabilities/oneTouch',
			data: {
				'flowId' : login.utils.getFlowId(),
				'optInSource':  login.utils.getIntent() === 'signin' ? 'overlay_dl' : 'overlay_xo', // snake case for instrumentation
				'_csrf': document.querySelector('#token').value
			},
			dataType: 'json',
			complete: function() {
				setIntervalId = setInterval(function(){

					// On interval, after activating OneTouch, redirect only after overlay was closed
					if($(overlayMask).hasClass('hide')) {

						// clear the interval else it will keep running in loop even if there is a redirect
						// and will only stop once completely redirected causing unnecessary redirections and logging
						clearInterval(setIntervalId);
						login.logger.log({
							evt: 'ONETOUCH',
							data: 'REDIRECT_AFTER_ACTIVATION_RESPONSE_' + login.utils.getIntent().toUpperCase(),
							calEvent: true
						});
						login.logger.pushLogs();

						return window.location.href = returnUrl;
					}
				}, 100)
			}
		});

		login.logger.log({
			evt: 'flow_type',
			data: 'onetouch',
			instrument: true
		});
		login.logger.log({
			evt: 'actiontype',
			data: 'turn_on',
			instrument: true
		});
		login.logger.log({
			evt: 'state_name',
			data: 'overlay',
			instrument: true
		});
		login.logger.log({
			evt: 'transition_name',
			data: 'process_overlay',
			instrument: true
		});
		login.logger.log({
			evt: 'ONETOUCH',
			data: 'CLICK_OPT_IN_BUTTON_OVERLAY_' + login.utils.getIntent().toUpperCase(),
			calEvent: true
		});
		login.logger.pushLogs();

		// Worst case, if One Touch activation has no response in 10000ms, redirect so that user is not stalled
		setTimeout(function() {
			login.logger.log({
				evt: 'ONETOUCH',
				data: 'REDIRECT_WITHOUT_ACTIVATION_RESPONSE_' + login.utils.getIntent().toUpperCase(),
				calEvent: true
			});
			login.logger.pushLogs();
			clearInterval(setIntervalId);
			return window.location.href = returnUrl;
		},10000);

	}

	function webauthnOverlayOptInClickHandler(event) {
		eventPreventDefault(event);
		clearTimeout(closeOverlayOnTimeoutFn);
		var clientLogStateName = {evt: 'state_name', data: 'FINGERPRINT_OPTIN', instrument: true};
		var webAuthnCalName = 'WEBAUTH_N_CLIENT';
		var returnUrl = $('body').data('return-url');
		login.logger.log({
			evt: 'flow_type',
			data: 'webauthn',
			instrument: true
		});
		login.logger.log({
			evt: 'actiontype',
			data: 'turn_on',
			instrument: true
		});
		login.logger.log({
			evt: 'state_name',
			data: 'overlay',
			instrument: true
		});
		login.logger.log({
			evt: 'transition_name',
			data: 'process_overlay',
			instrument: true
		});
		login.logger.log({
			evt: 'WEBAUTH_N_CLIENT',
			data: 'PROCESS_OVERLAY_' + login.utils.getIntent().toUpperCase(),
			calEvent: true
		});
		login.logger.pushLogs();
		function redirect(latency) {
			latency = latency || 0;

			// var returnUrl = document.getElementById('returnUrl');
			// Auto redirect after given latency
			setTimeout(function() {
				window.location.href = returnUrl || '/signin';
			}, latency);
		}
		closeOverlay();
		login.webAuthnOptInXHR()
			.then(function() {
				login.logger.clientLog([
					clientLogStateName,
					{evt: 'transition_name', data: 'process_consent_XHR', instrument: true},
					{evt: webAuthnCalName, data: 'BIND_SUCCESS_XHR_OVERLAY_' + login.utils.getIntent().toUpperCase(), calEvent: true}
				], function() {
					return redirect();
				});
			})
			.catch(function() {
				login.logger.clientLog([
					clientLogStateName,
					{evt: 'transition_name', data: 'process_error_XHR', instrument: true},
					{evt: webAuthnCalName, data: 'BIND_FAIL_XHR_OVERLAY_' + login.utils.getIntent().toUpperCase(), calEvent: true, status: 'ERROR'}
				], function() {
					return redirect();
				});
			});
	}

	function optInOverlayOnClickHandler(event) {
		if ($('body').data('overlay-variant') === 'oneTouch') {
			return oneTouchOverlayOptInClickHandler(event);
		}
		if ($('body').data('overlay-variant') === 'webAuthn') {
			return webauthnOverlayOptInClickHandler(event);
		}
	}

	function closeOverlayOnClickHandler() {

		login.logger.log({
			evt: 'actiontype',
			data: 'close_button',
			instrument: true
		});
		login.logger.log({
			evt: 'flow_type',
			data: $('body').data('overlay-variant').toLowerCase(),
			instrument: true
		});
		login.logger.log({
			evt: 'state_name',
			data: 'overlay',
			instrument: true
		});
		login.logger.log({
			evt: 'transition_name',
			data: 'process_overlay',
			instrument: true
		});
		login.logger.log({
			evt: getCalType(),
			data: 'CLICK_CLOSE_BUTTON_OVERLAY_' + login.utils.getIntent().toUpperCase(),
			calEvent: true
		});
		login.logger.pushLogs();

		var returnUrl = $('body').data('return-url');
		var overlayContainer = document.getElementById('overlayContainer');
		var overlayMask = document.getElementById('overlayMask');
		$(overlayContainer).removeClass('overlaySlideDown');
		$(overlayContainer).addClass('overlaySlideUp');
		// hide the mask only after 250 milliseconds of latency to show the animation of overlay sliding down
		setTimeout(function() {
			$(overlayMask).addClass('hide');
			return window.location.href = returnUrl || '/signin';
		},250);
	}

	function closeOverlay() {
		var overlayContainer = document.getElementById('overlayContainer');
		var overlayMask = document.getElementById('overlayMask');
		$(overlayContainer).removeClass('overlaySlideDown');
		$(overlayContainer).addClass('overlaySlideUp');
		// hide the mask only after 250 milliseconds of latency to show the animation of overlay sliding down
		setTimeout(function() {
			$(overlayMask).addClass('hide');
			return;
		},250);
	}

	function toggleOverlayDetailsOnClickHandler(){
		eventPreventDefault(event);
		clearTimeout(closeOverlayOnTimeoutFn);
		var overlayExpandDetails = document.getElementById('overlayExpandDetails');
		var overlayCollapseDetails = document.getElementById('overlayCollapseDetails');
		var overlayDetails = document.getElementById('overlayDetails');

		$(overlayExpandDetails).toggle();
		$(overlayCollapseDetails).toggle();

		if ($(overlayDetails).hasClass('overlaySlideUp')) {
			$(overlayDetails).removeClass('overlaySlideUp');
			$(overlayDetails).addClass('overlaySlideDown');
		} else {
			$(overlayDetails).removeClass('overlaySlideDown');
			$(overlayDetails).addClass('overlaySlideUp');
		}
	}

	function showOverlay(loginResponse) {
		var overlayOptIn = document.getElementById('overlayOptIn');
		var overlayExpandDetails = document.getElementById('overlayExpandDetails');
		var overlayCollapseDetails = document.getElementById('overlayCollapseDetails');
		var overlayClose = document.getElementById('overlayClose');
		var returnUrl = $('body').data('return-url'); // set when there is XHR login response
		var closeOverlayTimeoutValue = loginResponse && loginResponse.closeOverlayTimeoutValue;

		// Attach the respective handlers
		overlayOptIn.onclick = optInOverlayOnClickHandler;
		overlayClose.onclick = closeOverlayOnClickHandler;
		overlayExpandDetails.onclick = toggleOverlayDetailsOnClickHandler;
		overlayCollapseDetails.onclick = toggleOverlayDetailsOnClickHandler;

		// Safey check: Do not show overlay if there handlers are undefined else user will be stalled
		if(!overlayOptIn.onclick || !overlayClose.onclick) {
			return window.location.href = returnUrl || '/signin';
		}

		var email = document.getElementById('email');
		var password = document.getElementById('password');

		// Blur out email and password fields; phone is not an input field during password submit
		email && email.blur();
		password && password.blur();

		// Show the overlay
		var overlayContainer = document.getElementById('overlayContainer');
		var overlayMask = document.getElementById('overlayMask');
		$(overlayMask).removeClass('hide');
		$(overlayContainer).removeClass('overlaySlideUp');
		$(overlayContainer).addClass('overlaySlideDown');

		//  Instrument overlay has been shown
		login.logger.log({
			evt: 'flow_type',
			data: $('body').data('overlay-variant').toLowerCase(),
			instrument: true
		});
		login.logger.log({
			evt: 'state_name',
			data: 'overlay',
			instrument: true
		});
		login.logger.log({
			evt: 'transition_name',
			data: 'prepare_overlay',
			instrument: true
		});
		login.logger.log({
			evt: getCalType(),
			data: 'SHOWN_SUCCESSFULLY_OVERLAY_' + login.utils.getIntent().toUpperCase(),
			calEvent: true
		});
		login.logger.pushLogs();

		// add focus to close button after showing the overlay
		overlayClose.focus();

		// Add a timeout to close overlay
		if(closeOverlayTimeoutValue) {
			closeOverlayOnTimeoutFn = setTimeout(function(){

				//  Instrument overlay has been closed and redirected after a timeout
				login.logger.log({
					evt: 'flow_type',
					data: $('body').data('overlay-variant').toLowerCase(),
					instrument: true
				});
				login.logger.log({
					evt: 'state_name',
					data: 'overlay',
					instrument: true
				});
				login.logger.log({
					evt: 'transition_name',
					data: 'timeout_close_overlay',
					instrument: true
				});

				login.logger.log({
					evt: getCalType(),
					data: 'TIMEOUT_CLOSE_OVERLAY_AND_REDIRECT_' + login.utils.getIntent().toUpperCase(),
					calEvent: true
				});
				login.logger.pushLogs();

				var overlayContainer = document.getElementById('overlayContainer');
				var overlayMask = document.getElementById('overlayMask');
				$(overlayContainer).removeClass('overlaySlideDown');
				$(overlayContainer).addClass('overlaySlideUp');
				// hide the mask only after 250 milliseconds of latency to show the animation of overlay sliding down
				setTimeout(function() {
					$(overlayMask).addClass('hide');
					return window.location.href = returnUrl || '/signin';
				},250);
			}, closeOverlayTimeoutValue);
		}

	}

	function isEligibleToShowOverlay(loginResponse) {
		var overlayVariant = $('body').data('overlay-variant') || 'unknown';
		var oneTouchOverlayEligibility = (overlayVariant === 'oneTouch') && (loginResponse && loginResponse.oneTouchOverlayPostOptinEligible);
		var webAuthnOverlayEligibility = (overlayVariant === 'webAuthn') && (loginResponse && loginResponse.webAuthnOverlayPostOptinEligible);
		var overlaySectionExists = !!document.getElementById('overlay');

		// TBD: Add some delay to render overlay in DOM since it is fetched lazily ONLY if elg based on oneTouchOverlayEligibility
		// Log if template not yet loaded
		if((oneTouchOverlayEligibility || webAuthnOverlayEligibility) && !overlaySectionExists){
			login.logger.log({
				evt: getCalType(),
				data: 'NOT_SHOWN_SINCE_TEMPLATE_NOT_LOADED_OVERLAY_' + login.utils.getIntent().toUpperCase(),
				calEvent: true
			});
			login.logger.pushLogs();
		}

		return  (oneTouchOverlayEligibility || webAuthnOverlayEligibility) && overlaySectionExists;
	}

	function isLoginXHREligbleForOverlay() {
		var overlayVariant = $('body').data('overlay-variant') || 'unknown';
		if (overlayVariant === 'webAuthn' || overlayVariant === 'oneTouch') {
			login.logger.log({
				evt: getCalType(),
				data: 'XHR_LOGIN_ELIGIBLE_OVERLAY_' + login.utils.getIntent().toUpperCase() ,
				calEvent: true
			});
			login.logger.pushLogs();
			return true;
		}
		return false;
	}

	function getCalType() {
		var overlayVariant = $('body').data('overlay-variant') || 'unknown';
		var calType = '';

		switch(overlayVariant) {
			case 'webAuthn':
				calType =  'WEBAUTH_N_CLIENT';
				break;
			case 'oneTouch':
				calType =  'ONETOUCH';
				break;
			default:
				calType = 'UNIFIED_LOGIN';
		}

		return calType;

	}

	return {
		showOverlay: showOverlay,
		isEligibleToShowOverlay: isEligibleToShowOverlay,
		isLoginXHREligbleForOverlay: isLoginXHREligbleForOverlay
	}

}());

// LOGIN
login.core = (function() {
	return function core() {
		/*
		 * Put together dom objects for email, password, phone, pin such that they can be easily passed to validator
		 * methods with a common interface
		 */
		var UNIFIED_LOGIN_CAL_TYPE = 'UNIFIED_LOGIN'
		var XHR_LOGIN_CAL_TYPE = 'XHR_LOGIN';
		var notifications = document.querySelector('#notifications');
		var splitLoginCookiedFallback = document.querySelector('input[name="splitLoginCookiedFallback"]');
		// The Email DOM contains the email field and it's associated error messages
		var emailDom = {
			container: document.querySelector('#login_emaildiv'),
			field: document.querySelector('#email'),
			label: document.querySelector('label[for="email"]'),
			errMsgContainer: document.querySelector('#emailErrorMessage'),
			errMsg: document.querySelector('#emailErrorMessage .emptyError'),
			invalidMsg: document.querySelector('#emailErrorMessage .invalidError'),
			phoneEmailToggleIcon: document.querySelector('#login_emaildiv .icon'),
			type: 'email'
		};

		var emailMaskDOM = document.querySelector('.textInputMask.email');

		// The Password DOM contains the password field and it's associated error messages
		var passwordDom = {
			container: document.querySelector('#login_passworddiv'),
			field: document.querySelector('#password'),
			errMsgContainer: document.querySelector('#passwordErrorMessage'),
			errMsg: document.querySelector('#passwordErrorMessage .emptyError')
		};

		// The Phone country code DOM contains the list of two letter phone country code
		var phoneCodeDom = {
			container: document.querySelector('#pinSection') || document.querySelector('.splitPhoneSection'),
			field: document.querySelector('#phoneCode')
		};

		// The Phone DOM contains the phone field and it's associated error messages
		var phoneDom = {
			container: document.querySelector('#login_phonediv'),
			field: document.querySelector('#phone'),
			errMsgContainer: document.querySelector('#phoneErrorMessage'),
			errMsg: document.querySelector('#phoneErrorMessage .emptyError'),
			invalidMsg: document.querySelector('#phoneErrorMessage .invalidError')
		};

		// The Pin DOM contains the pin field and it's associated error messages
		var pinDom = {
			container: document.querySelector('#login_pindiv'),
			field: document.querySelector('#pin'),
			errMsgContainer: document.querySelector('#pinErrorMessage'),
			errMsg: document.querySelector('#pinErrorMessage .emptyError')
		};

		var splitLoginContextField = document.querySelector('input[name=splitLoginContext]');

		var loginForm = document.querySelector('.proceed');

		// Login buttons
		var btnNext = document.querySelector('#btnNext');
		var btnLogin = document.querySelector('#btnLogin');

		// Actions button
		var btnActions = document.querySelector('.actions');

		// Email & Password Section and Phone & Pin Sections
		var passwordSection = document.querySelector('#splitEmailSection') || document.querySelector('#passwordSection');
		var pinSection = document.querySelector('#splitPhoneSection') || document.querySelector('#pinSection');
		// pinDiv for Pin icon toggle hide and show retiring phone pin message
		var pinDiv = document.querySelector('#splitPassword') ||
			document.querySelector('#splitPinSection') ||
			document.querySelector('#pinSection');
		var emailIcon = document.querySelector('.email');
		var phoneIcon = document.querySelector('.phone');
		var switchToPhoneDiv = document.querySelector('#loginWithPhoneOption');
		var switchToPhoneLink = document.querySelector('#switchToPhone');
		var switchToEmailDiv = document.querySelector('#loginWithEmailOption');
		var switchToEmailLink = document.querySelector('#switchToEmail');
		var countryPhoneSelectWrapper = document.querySelector('.countryPhoneSelectWrapper');
		var emailPageSwitch = document.querySelector('#emailPageSwitch');

		// retiring education message for phone pin
		var retiringPhonePinMsg = document.querySelector('.educationMessage');

		// Tagline for XO usecase
		var emailSubTagLine = document.querySelector('#emailSubTagLine');
		var phoneSubTagLine = document.querySelector('#phoneSubTagLine');

		// Password recovery button
		var pwrButton = document.querySelector('.forgotLink');
		var pwrLink = pwrButton && pwrButton.querySelectorAll('.pwrLink');
		var pwrIframe = pwrButton && pwrButton.querySelector('#pwdIframe');

		// More options DOM
		var moreOptionsMobileLink = document.querySelector('#moreOptionsMobile');
		var moreOptionsDropDown = document.querySelector('#moreOptionsDropDown');
		var tpdButton = document.querySelector('#tpdButton');
		var isHybrid = login.utils.isHybridLoginExperience();
		var isHybridEditableOnCookied = login.utils.isHybridEditableOnCookied();
		var tpdDemo = document.querySelector('#tpdDemo');
		var ctxId = document.querySelector('input[name="ctxId"]');
		var keepMeLoginCheckBoxContainer = document.querySelector('.keepMeLogin');
		var samlSsoLoginLink = document.querySelector('#samlSsoLogin');

		// E2E password encryption setup
		var stsPublicKey = document.body.hasAttribute('data-stspublickey');
		var encryptedPassword = '';
		var loadingEncryptionSetup = true;
		var currentlyEncrypting = false;
		var allowEncryption = true;
		if (stsPublicKey) {
			stsPublicKey = document.body.getAttribute('data-stspublickey');
			var sm2PublicKey = document.body.getAttribute('data-sm2PublicKey');

			// Disable copying and pasting into password field
			passwordDom.field.addEventListener('copy', function(e) {
				e.preventDefault();
			});
			passwordDom.field.addEventListener('paste', function(e) {
				e.preventDefault();
			});

			// Remove option to show password
			document.querySelector('.showPassword').style.display = 'none'
  			function encryptionSetup(importedPublicKey) {
				function encodeMessage(message) {
					var enc = new TextEncoder();
					return enc.encode(message);
				}
				function arrayBufferToBase64(buf) {
					return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
				}
				function updateEncryptedPassword(buf) {
					var cipherTextBase64 = arrayBufferToBase64(buf);
					encryptedPassword = cipherTextBase64;

					currentlyEncrypting = false;
				}
				function encryptPassword(password) {
					if (currentlyEncrypting || !allowEncryption) {
						return ;
					}

					currentlyEncrypting = true;

					// if we have sm2 public key, then will do sm2 encryption.
					if (sm2PublicKey) {
						const publicKey = sm2PublicKey;
						const cipherMode = 1;
						const cypherText = sm2.doEncrypt(password, publicKey, cipherMode)
						encryptedPassword = btoa(cypherText);

						currentlyEncrypting = false;
					} else {
						window.crypto.subtle
							.encrypt(
								{ name: "RSA-OAEP" },
								importedPublicKey,
								encodeMessage(password)
							)
							.then(updateEncryptedPassword)
							.catch(function (err) {
								throw new Error(err);
							});
					}
				}

				addEvent(passwordDom.field, "keyup", function (event) {
					encryptPassword(event.target.value);
				});

				/*
					Incase user tries to log in or type inside password
					field before encryption setup has finished
				*/
				if (passwordDom.field.value && !currentlyEncrypting && allowEncryption) {
					encryptPassword(passwordDom.field.value);
				}

				loadingEncryptionSetup = false;
			}

			window.crypto.subtle
				.importKey(
					"jwk",
					JSON.parse(stsPublicKey),
					{ name: "RSA-OAEP", hash: { name: "SHA-256" } },
					true,
					["encrypt"]
				)
				.then(encryptionSetup)
				.catch(function (err) {
					throw new Error(err);
				});
		}

		if(login.utils.isCookieDisabledBrowser() && keepMeLoginCheckBoxContainer) {
			$(keepMeLoginCheckBoxContainer).addClass('hide');
		}

		if (samlSsoLoginLink) {
			login.logger.log({
				evt: 'is_saml_link_shown',
				data: 'y',
				instrument: true
			});
			login.logger.pushLogs();
		}

		function toggleMoreOptions(event) {
			var evtTarget = getEventTarget(event);
			if (!moreOptionsDropDown || !event || !evtTarget) {
				return;
			}

			if ($(evtTarget).hasClass('moreOptionsInfo')) {
				eventPreventDefault(event);

				// Instrument more options clicked only when it is to be shown
				if ($(moreOptionsDropDown).hasClass('hide')) {
					login.logger.log({
						evt: 'state_name',
						data: isHybrid ? 'begin_hybrid_pwd' : 'begin_pwd',
						instrument: true
					});

					login.logger.log({
						evt: 'transition_name',
						data: isHybrid ? 'process_hybrid_pwd_more_opt' : 'process_pwd_more_opt',
						instrument: true
					});

					login.logger.log({
						evt: 'TPD_CLIENT',
						data: 'CLICKED_MORE_OPTIONS',
						calEvent: true
					});

					login.logger.pushLogs();
				}

				// toggle to show/hide the more options dropdown when the link is clicked
				$(moreOptionsDropDown).removeClass('hide');
				return;
			}
			// any other place, hide the dropdown
			$(moreOptionsDropDown).addClass('hide');
		}
		function toggleTpdDemoBubble(event) {
			var evtTarget = getEventTarget(event);
			if (!tpdDemo || !event || !evtTarget) {
				return;
			}
			$(tpdDemo).addClass('hide');

		}
		/**
		 * Strip country code from user's input if it's already in the country select box.
		 * For example, in the select box can be "+1". If a user writes in the phone input field: "+1 123 456 7890",
		 * then we would strip "+1", so the final value would be "123 456 7890".
		 * @param {String} phone
		 * @return {String}
		 */
		function stripPhoneCountryCodeIfExists(phone) {
			if (!phoneCodeDom) {
				return phone;
			}
			var phoneCodeContainer = phoneCodeDom.container.querySelector('.phoneCode');
			var phoneCountryCode = phoneCodeContainer && $(phoneCodeContainer).text();
			var doesPhoneStartWithPhoneCountryCode = phone.lastIndexOf(phoneCountryCode, 0) === 0;
			if (!doesPhoneStartWithPhoneCountryCode) {
				return phone;
			}
			return phone.substr(phoneCountryCode.length); // "substr" takes parameters as (from, length)
		}

		/**
		 * Shows the country select box if a user is entering a phone number.
		 * @param {String} emailOrPhoneValue
		 */
		function switchBetweenPhoneAndEmailOnUserInput(emailOrPhoneValue) {
			if (splitLoginContextField && splitLoginContextField.value === 'inputPassword' &&
				!isHybridEditableOnCookied) {
				// IMPORTANT: Don't continue if a user is on the password page
				// and there is no hybrid input. E.g. Safari was triggering this function during autofill,
				// which is not desired and can cause that a user will not be able to login.
				return;
			}
			var isSplitLoginContextEmail = splitLoginContextField && splitLoginContextField.value === 'inputEmail';
			if (!isHybridEditableOnCookied && isSplitLoginContextEmail && loginType === 'phone') {
				// Reset loginType to 'email' if the split login context is email. That could be the case e.g.
				// for unconfirmed phone login attempts.
				loginType = 'email';
			}
			if (login.utils.doesItLookLikeEmail(emailOrPhoneValue)) {
				if (loginType !== 'email') {
					!isHybridEditableOnCookied && splitLoginContextField.setAttribute('value', 'inputEmail');
					loginType = 'email';
					$(countryPhoneSelectWrapper) && $(countryPhoneSelectWrapper).addClass('hide');
					$(emailDom.container).removeClass('phoneInputWrapper');
				}
			} else {
				phoneDom.field.value = emailOrPhoneValue;
				if (loginType !== 'phone') {
					!isHybridEditableOnCookied && splitLoginContextField.setAttribute('value', 'inputPhone');
					loginType = 'phone';
					$(countryPhoneSelectWrapper).removeClass('hide');
					$(emailDom.container).addClass('phoneInputWrapper');
				}
			}
		}

		/**
		 * Reset values for form fields.
		 */
		function resetForm() {
			phoneDom.field.value = null;
			emailDom.field.value = null;

			// Hide masking DOM for email field
			emailMaskDOM && $(emailMaskDOM).addClass('hide');
			// If hybrid was set to email only, the following code will return it to email or phone input.
			var model = login.storeInstance.getState().model;
			var emailOrPhoneLabel = model && model.contextualLogin && model.contextualLogin.content
				&& model.contextualLogin.content.emailOrPhoneLabel; // So ugly, it would be much nicer with Lodash.
			$(emailDom.field).attr('placeholder', emailOrPhoneLabel);
			$(emailDom.label).text(emailOrPhoneLabel);
			emailDom.field.removeAttribute('data-hybrid-in-email-only-mode');
		}

		function onEmailOrPhoneInputOrChange(event) {
			var target = getEventTarget(event);
			var hybridInEmailOnlyMode = emailDom.field &&
				$(emailDom.field).attr('data-hybrid-in-email-only-mode') === 'true';
			if (hybridInEmailOnlyMode && loginType !== 'email') {
				loginType = 'email'; // If it's hybridInEmailOnlyMode, login type was 'phone', so we need to reset it.
			}
			if (!target || hybridInEmailOnlyMode) {
				return;
			}
			login.pubsub.publish('CLEAR_OTP_LOGIN_CONTEXT');
			switchBetweenPhoneAndEmailOnUserInput(target.value);
		}

		function onEmailOrPhoneInputEdit() {
			if (isHybridEditableOnCookied && emailDom.field) {
				login.logger.log({
					evt: 'state_name',
					data: 'cookied_user_change_email',
					instrument: true
				});
				login.logger.log({
					evt: 'transition_name',
					data: 'cookied_user_change_email',
					instrument: true
				});
				login.logger.pushLogs();
				emailDom.field.removeEventListener('input', onEmailOrPhoneInputEdit);
			}
		}

		if (isHybrid) {
			// The input event is fired when the user changes the value of an <input> element,
			// e.g. via a keyboard, using autoprefill or pasting a value via a mouse.
			// More here about the "input" event and browser support: https://caniuse.com/#feat=input-event
			addEvent(emailDom.field, 'input', onEmailOrPhoneInputOrChange);

			// The change event is triggered when the input field looses focus. It's here as a backup plan
			// for the input event above, because that one is not well supported in e.g. IE9.
			addEvent(emailDom.field, 'change', onEmailOrPhoneInputOrChange);

			// The input event is fired when the user changes the value of an <input> element,
			// the event listener will be removed to make sure log once only
			addEvent(emailDom.field, 'input', onEmailOrPhoneInputEdit);

			addEvent(samlSsoLoginLink, 'click', onSamlSsoLoginClickEventHandler);
		}

		if (isHybridEditableOnCookied) {
			// When cookied hybrid loads, we want to update UI with a country code dropdown if a phone was submited.
			switchBetweenPhoneAndEmailOnUserInput(emailDom.field.value);
		}

		if (login.pubsub) {
			login.pubsub.subscribe('WINDOW_CLICK', toggleMoreOptions);
			login.pubsub.subscribe('WINDOW_CLICK', toggleTpdDemoBubble);
		}

		var createAccount = document.querySelector('#createAccount');
		if (createAccount) {
			createAccount.onclick = function(e) {
				var stateName = login.logger.getStateName();
				login.utils.getOutboundLinksHandler(createAccount, stateName, 'process_signup')(e);
			}
		}

		var backToInputEmailLink = document.querySelector('#backToInputEmailLink');
		var ssoInterstitialBackToInputEmailLink = document.querySelector('#ssoInterstitialBackToInputEmailLink');
		var backToEmailPasswordLink = document.querySelector('#backToEmailPasswordLink');
		// Remember Profile link is only shown in splitEmail for now.
		var rememberProfileCheckBox = document.querySelector('#rememberProfileEmail');

		// Basic validation regex
		var EMPTY_PTN = /^\s+|\s+$/;
		var EMAIL_PTN = /^\S+@\S+\.\S+$/;
		var INVALID_PHONE = /[^\d]+/g;
		var INVALID_USERID_PTN = /\s/g;
		var PAYPAL_ONE_TOUCH = 'PayPal One Touch™';
		// Only hyphen, brackets, dot and spaces are allowed to be tyoed with phone numbers
		// They will be stripped off from the phone before validation and submit to server.
		// To ensure we get the number only for the server to validate the credentials.
		var STRIP_SYMBOLS_FROM_PHONE = /[-().\s]/ig;

		// Enable on keyup input field validation only when submit was clicked
		var validateOnKeyUp = false;

		// Smartlock form
		var smartlockForm = document.querySelector('form[name=smartlockForm]');

		// Switch to Password page in smartlock
		var secondaryLoginBtn = document.querySelector('#secondaryLoginBtn');

		var phonePasswordEnabled = $('body').data('phonePasswordEnabled');
		var phonePinEnabled = $('body').data('phonePinEnabled');

		// Maintain what type of login is being used (email/password or phone/pin)
		var loginType = getDefaultLoginType();

		/*
		Safari support for showing spinner in case of full page form submission
		To be enabled only if this is raised as a issue
		var isSafari = navigator.vendor && navigator.vendor.indexOf('Apple') > -1 &&
		navigator.userAgent && !navigator.userAgent.match('CriOS');
		 */

		/**
		 * Generic function to trim a string
		 * @param {String} str
		 */
		function trim(str) {
			if (!str || typeof str !== 'string') {
				return;
			}
			return str.replace(EMPTY_PTN, '');
		}

		function validateFieldHasValue(dom) {
			if (!dom.field) {
				// When dom field is not present, we cant draw the error, so safely not throw error.
				return true;
			}
			if (!trim(dom.field.value)) {
				showError(dom); // Draw a red border around the field with an exclaimation icon
				showRequiredError(dom); // Slide down field level error notification
				return false;
			}
			return true;
		}

		function isValidPhone(phoneDom) {
			var phone = phoneDom && phoneDom.field && phoneDom.field.value;

			if (!phoneDom || !phoneDom.field || phoneDom.field.hasAttribute('disabled')) {
				// early return true, as we dont need to validate a disabled field
				return true;
			}
			if (!phone) {
				showError(phoneDom); // Draw a red border around the field with an exclaimation icon
				showRequiredError(phoneDom); // Slide down field level error notification
				hideInvalidError(phoneDom);
				return false;
			}
			// remove symbols and match against patern
			phone = phone && phone.replace(STRIP_SYMBOLS_FROM_PHONE, '');
			if (!phone || phone.match(INVALID_PHONE)) {
				showError(phoneDom); // Draw a red border around the field with an exclaimation icon
				showInvalidError(phoneDom); // Slide down field level error notification
				hideRequiredError(phoneDom);
				return false;
			}
			return true;
		}

		function isValidUserId(emailDom) {
			var email = emailDom && emailDom.field && trim(emailDom.field.value);

			if (emailDom && emailDom.field && emailDom.field.hasAttribute('disabled')) {
				// early return true, as we dont need to validate a disabled field
				return true;
			}
			if (!email) {
				showError(emailDom); // Draw a red border around the field with an exclaimation icon
				showRequiredError(emailDom); // Slide down field level error notification
				return false;
			}
			// Allow PayPal OneTouch™ to be valid user id
			if (email === PAYPAL_ONE_TOUCH) {
				return true;
			}
			if (email && email.match(INVALID_USERID_PTN)) {
				showError(emailDom); // Draw a red border around the field with an exclaimation icon
				showInvalidError(emailDom); // Slide down field level error notification
				return false;
			}
			return true;
		}

		/**
		 * Validate required/valid email, password, phone, pin and captcha (if present)
		 * @param {Object} userIdDom The dom for either email or password
		 * @param {Object} userPwdDom The dom for either password or pin
		 */
		function validateRequiredFields(userIdDom, userPwdDom) {
			var email, pwd;
			var captchaOk = true;   // Scenario where captcha was not shown
			var captchaDom = login.utils.getActiveCaptchaElement(splitLoginContextField);

			email = validateFieldHasValue(userIdDom);
			if (!email) {
				return false;
			}

			pwd = validateFieldHasValue(userPwdDom);
			if (!pwd) {
				return false;
			}

			if (captchaDom && captchaDom.field) { // Captcha was shown
				captchaOk = validateFieldHasValue(captchaDom);
			}

			if (!captchaOk) {
				return false;
			}

			return true;
		}

		/**
		 * Finds currently active Remember Profile checkbox in split-login
		 * @param {Object} splitLoginContext
		 */
		function getActiveRememberProfileElement(splitLoginContext) {
			if (splitLoginContext.value === 'inputEmail') {
				return document.querySelector('#rememberProfileEmail');
			}

			if (splitLoginContext.value === 'inputPassword') {
				return document.querySelector('#rememberProfilePassword');
			}

			// Non-split-login page
			return;
		}

		/**
		 * Validate email
		 * @param {Object} emailDom
		 */
		function validateEmail(emailDom) {
			var trimmedEmail = emailDom.field.value.replace(EMPTY_PTN, '');
			// Allow PayPal OneTouch™ to be a valid user email
			if (trimmedEmail === PAYPAL_ONE_TOUCH) {
				return true;
			}
			if (!trimmedEmail.match(EMAIL_PTN) && !emailDom.field.hasAttribute('disabled')) {
				showError(emailDom);
				showInvalidError(emailDom);
				return false;
			}
			return true;
		}

		/**
		 * Show error container
		 * @param {Object} dom The DOM object which has the error div
		 */
		function showError(dom) {
			$(dom.container).addClass('hasError');
			dom.container.style['z-index'] = 100;
			$(dom.errMsgContainer).addClass('show');
			dom.field.focus();
		}

		/**
		 * Show the required error message
		 * @param {Object} dom The DOM object which has the error div
		 */
		function showRequiredError(dom) {
			$(dom.errMsg).removeClass('hide');
		}

		/**
		 * Show a invalid error message
		 * @param {Object} dom The DOM object which has the error div
		 */
		function showInvalidError(dom) {
			$(dom.invalidMsg).removeClass('hide');
		}

		/**
		 * Hide the error message(s) container
		 * @param {Object} dom The DOM object which has the error div
		 */
		function hideError(dom, removeErrHighlight) {
			if (removeErrHighlight) {
				$(dom.container).removeClass('hasError');
			}
			dom.container.style['z-index'] = 1;
			$(dom.errMsgContainer).removeClass('show');
		}

		/**
		 * Hide the required error message
		 * @param {Object} dom The DOM object which has the error div
		 */
		function hideRequiredError(dom) {
			$(dom.errMsg).addClass('hide');
		}

		/**
		 * Show the invalid error message
		 * @param {Object} dom The DOM object which has the error div
		 */
		function hideInvalidError(dom) {
			$(dom.invalidMsg).addClass('hide');
		}

		function updatePwrForRecoveryUsingEmail() {
			var newHref, phoneRecoveryPTN = /\&passwordRecoveryByPhoneEnabled\=true/;
			// reset PWR links to email recovery
			if (pwrLink) {
				for (var i = 0; i < pwrLink.length; i++) {
					newHref = pwrLink[i].getAttribute('href').replace(phoneRecoveryPTN, '');
					pwrLink[i].setAttribute('href', newHref);
				}
			}
			if (pwrIframe) {
				pwrIframe.setAttribute('data-src', pwrIframe.getAttribute('data-src').replace(phoneRecoveryPTN, ''));
			}
		}

		function updatePwrForRecoveryUsingPhone() {
			var newHref;
			if (pwrLink) {
				for (var i = 0; i < pwrLink.length; i++) {
					newHref = pwrLink[i].getAttribute('href') + '&passwordRecoveryByPhoneEnabled=true';
					pwrLink[i].setAttribute('href', newHref);
				}
			}
			if (pwrIframe) {
				pwrIframe.setAttribute('data-src', pwrIframe.getAttribute('data-src') + '&passwordRecoveryByPhoneEnabled=true');
			}
		}

		/**
		 * Enable email and password fields.
		 * Disable phone and pin fields.
		 */
		function enableEmailPassword() {
			var splitLoginContext = document.querySelector('input[name="splitLoginContext"]');
			var splitLoginCookiedFallback = document.querySelector('input[name="splitLoginCookiedFallback"]');
			// Show the email/password section
			$(passwordSection).removeClass('hide');
			// Hide the phone/pin section
			$(pinSection).addClass('hide');
			if (retiringPhonePinMsg) {
				$(retiringPhonePinMsg).addClass('hide');
			}
			// Enable email & password fields
			emailDom.field && emailDom.field.removeAttribute('disabled');
			passwordDom.field && passwordDom.field.removeAttribute('disabled');

			// Disable phone & pin fields (so that they are not sent to the server when the form is submitted)
			phoneCodeDom.field && phoneCodeDom.field.setAttribute('disabled', 'disabled');
			phoneDom.field && phoneDom.field.setAttribute('disabled', 'disabled');
			pinDom.field && pinDom.field.setAttribute('disabled', 'disabled');

			// Show the password recovery button
			if (!phonePasswordEnabled) {
				$(pwrButton).removeClass('hide');
			}
			switchToEmailDiv && $(switchToEmailDiv).addClass('hide');
			$(btnActions).removeClass('phonePresent');

			// Set login type (required for validation)
			loginType = 'email';

			// Set split login context to inputEmail if split login is enabled
			if (splitLoginContext) {
				// show email tagLine if present
				emailSubTagLine && $(emailSubTagLine).removeClass('hide');
				splitLoginContext.value = 'inputEmail';
				if (splitLoginCookiedFallback) {
					splitLoginContext.value = 'inputPassword';
				}
			}
		}

		/**
		 * Enable phone and pin fields.
		 * Disable email and password fields.
		 */
		function enablePhonePin() {
			var splitLoginContext = document.querySelector('input[name="splitLoginContext"]');
			// Show the phone/pin section
			$(pinSection).removeClass('hide');
			$(passwordSection).addClass('hide');
			if (retiringPhonePinMsg && !$(pinDiv).hasClass('hide')) {
				$(retiringPhonePinMsg).removeClass('hide');
			}
			// Enable phone & pin fields
			phoneCodeDom.field && phoneCodeDom.field.removeAttribute('disabled');
			phoneDom.field && phoneDom.field.removeAttribute('disabled');
			pinDom.field && pinDom.field.removeAttribute('disabled');

			// Disable email & password fields (so that they are not sent to the server when the form is submitted)
			emailDom.field && emailDom.field.setAttribute('disabled', 'disabled');
			passwordDom.field && passwordDom.field.setAttribute('disabled', 'disabled');

			// Hide the password recovery button as it's not applicable for a phone/pin login
			$(pwrButton).addClass('hide');
			$(btnActions).addClass('phonePresent');

			switchToPhoneDiv && $(switchToPhoneDiv).addClass('hide');

			// Set login type (required for validation)
			loginType = 'phone';

			// hide email tagLine if present (this is only applicable to split login
			emailSubTagLine && $(emailSubTagLine).addClass('hide');

			// Set split login context to inputPassword if split login is enabled
			if (splitLoginContext && !phonePasswordEnabled) {
				// set inputPin as the context when in cookied fallback.
				// In this scenario the toggle will show the phone and pin
				splitLoginContext.value = (splitLoginContext.value === 'inputPassword' ? 'inputPin' : 'inputPhone');
			}
		}

		function onPhoneCodeChangeEventHandler() {
			var countryCode = phoneCodeDom.container.querySelector('.countryCode');
			var phoneCode = phoneCodeDom.container.querySelector('.phoneCode');
			var dropDown = phoneCodeDom.field;
			var dropDownValue;

			function getDropDownValue() {
				var str = dropDown.options[dropDown.selectedIndex].value;
				var arr = str.split(' ');
				return {
					countryCode: arr && (arr[0] || ''),
					phoneCode: arr && (arr[1]  || '')
				}
			}

			dropDownValue = getDropDownValue();
			$(countryCode).text(dropDownValue.countryCode);
			$(phoneCode).text(dropDownValue.phoneCode);
		}

		function onPhoneCodeClickEventHandler() {
			login.logger.log({
				evt: 'state_name',
				data: 'begin_hybrid_login',
				instrument: true
			});
			login.logger.log({
				evt: 'transition_name',
				data: 'click_change_country_code',
				instrument: true
			});
			login.logger.pushLogs();
		}

		/**
		 * Enable phone login in split screen
		 */
		function switchToPhoneLogin(event) {
			// prevent the href default action
			eventPreventDefault(event);
			var splitLoginContext = document.querySelector('input[name="splitLoginContext"]');
			var countryPhoneSelectWrapper = document.querySelector('.countryPhoneSelectWrapper');
			// Show the phone section
			$(pinSection).removeClass('hide');
			// Hide the email section
			$(passwordSection).addClass('hide');
			// Hide switching to phone and show switching to email option
			$(switchToPhoneDiv).addClass('hide');
			$(switchToEmailDiv).removeClass('hide');

			// hide errors in emailDom if any
			hideError(emailDom, true);
			// Enable phone & password fields
			phoneCodeDom.field && phoneCodeDom.field.removeAttribute('disabled');
			phoneDom.field && phoneDom.field.removeAttribute('disabled');
			phoneDom.field.focus();

			// hide email tagLine and show phone tagLine if present
			emailSubTagLine && $(emailSubTagLine).addClass('hide');
			phoneSubTagLine && $(phoneSubTagLine).removeClass('hide');

			// Clear email & any notifications if present on the page
			// This is possible in case of risk decline in public credentials submission
			if (emailDom.field) {
				emailDom.field.value = '';
			}
			login.view.updateNotificationView({});

			// Disable email & pin fields (so that they are not sent to the server when the form is submitted)
			emailDom.field && emailDom.field.setAttribute('disabled', 'disabled');
			// set the splitlogin context
			splitLoginContext.value = 'inputPhone';
			// Log the state_name in FPTI SS - the current state and new transition
			login.logger.log({
				evt: 'state_name',
				data: 'begin_email',
				instrument: true
			});
			// log the new transition in FPTI SS
			login.logger.log({
				evt: 'transition_name',
				data: 'prepare_phone',
				instrument: true
			});
			login.logger.pushLogs();
			// Log the new state of phone and transition
			login.logger.log({
				evt: 'state_name',
				data: 'begin_phone',
				instrument: true
			});
			// log the new transition in FPTI SS
			login.logger.log({
				evt: 'transition_name',
				data: 'prepare_phone',
				instrument: true
			});
			login.logger.pushLogs();
			// If phone PIN is enabled, have the PIN enabled and password disabled. Else the otherway.
			if (phonePinEnabled) {
				pinDom.field && pinDom.field.removeAttribute('disabled');
				passwordDom.field && passwordDom.field.setAttribute('disabled', 'disabled');
				// Set login type (required for validation)
				loginType = 'phone';
				$(btnActions).addClass('phonePresent');
				// Set split login context to phone if split login is enabled
				// Hide the password recovery button as it's not applicable for a phone/pin login
				$(pwrButton).addClass('hide');
			} else {
				passwordDom.field && passwordDom.field.removeAttribute('disabled');
				pinDom.field && pinDom.field.setAttribute('disabled', 'disabled');
				// Set login type (required for validation)
				loginType = 'phonePassword';
				countryPhoneSelectWrapper && $(countryPhoneSelectWrapper).removeClass('hide');
			}
		}

		/**
		 * Enable email login in split screen
		 */
		function switchToEmailLogin(event) {
			eventPreventDefault(event);
			var splitLoginContext = document.querySelector('input[name="splitLoginContext"]');
			// Show the email section
			$(passwordSection).removeClass('hide');
			// Hide the phone section
			$(pinSection).addClass('hide');
			// Hide switching to email and show switching to phone option
			$(switchToEmailDiv).addClass('hide');
			$(switchToPhoneDiv).removeClass('hide');
			if (retiringPhonePinMsg) {
				$(retiringPhonePinMsg).addClass('hide');
			}
			// hide errors in phoneDom if any
			hideError(phoneDom, true);
			// Enable email & password fields
			emailDom.field && emailDom.field.removeAttribute('disabled');
			passwordDom.field && passwordDom.field.removeAttribute('disabled');
			emailDom.field.focus();

			// Disable phone & pin fields (so that they are not sent to the server when the form is submitted)
			phoneCodeDom.field && phoneCodeDom.field.setAttribute('disabled', 'disabled');
			phoneDom.field && phoneDom.field.setAttribute('disabled', 'disabled');
			pinDom.field && pinDom.field.setAttribute('disabled', 'disabled');

			// hide phone tagLine and show email tagLine if present
			phoneSubTagLine && $(phoneSubTagLine).addClass('hide');
			emailSubTagLine && $(emailSubTagLine).removeClass('hide');

			$(btnActions).removeClass('phonePresent');

			// Set login type (required for validation)
			loginType = 'email';

			// Set split login context to inputEmail if split login is enabled
			splitLoginContext.value = 'inputEmail';
			// Log the state_name in FPTI SS - current state of phone and new transition
			login.logger.log({
				evt: 'state_name',
				data: 'begin_phone',
				instrument: true
			});
			// log the new transition in FPTI SS
			login.logger.log({
				evt: 'transition_name',
				data: 'prepare_email',
				instrument: true
			});
			login.logger.pushLogs();
			// Log the state_name in FPTI SS - new state of email and new transition
			login.logger.log({
				evt: 'state_name',
				data: 'begin_email',
				instrument: true
			});
			// log the new transition in FPTI SS
			login.logger.log({
				evt: 'transition_name',
				data: 'prepare_email',
				instrument: true
			});
			login.logger.pushLogs();
		}

		/*
		 * This function performs a notYou and takes the user back to email page.
		 * The reason for doing not you is, even a cookied user may click the link to switch to email, in which case
		 * the rmuc with phone should still be cleared.
		 */
		function switchToSplitEmailFromPasswordPage(event, callback) {
			eventPreventDefault(event);
			updatePwrForRecoveryUsingEmail();
			loginType = 'email';
			login.utils.notYouClickHandler(event, function() {
				// Log the state_name in FPTI SS - current state of phone password and new transition
				login.logger.log({
					evt: 'state_name',
					data: 'begin_phone_pwd',
					instrument: true
				});
				// log the new transition in FPTI SS
				login.logger.log({
					evt: 'transition_name',
					data: 'prepare_email',
					instrument: true
				});
				login.logger.pushLogs();
				// Log the state_name in FPTI SS - new state of email and new transition
				login.logger.log({
					evt: 'state_name',
					data: 'begin_email',
					instrument: true
				});
				// log the new transition in FPTI SS
				login.logger.log({
					evt: 'transition_name',
					data: 'prepare_email',
					instrument: true
				});
				login.logger.pushLogs();
				if (typeof callback === 'function') {
					callback();
				}
			});
		}

		function onFormSubmitHandler(event) {
			var enableSuppressAutoSubmit = $('body').data('enableSuppressAutoSubmit') === 'true';
			var timeLapseForAutoSubmit = Date.now() - window.formAutofilledAt;
			var shouldSuppressForSubmit = parseInt($('body').data('suppressAutosubmitTime')) >= timeLapseForAutoSubmit;
			var autoSubmitCalType = 'AUTOSUBMIT';
			var isKeychainActivationWithEmailTokenOn8ball = document.querySelector('input[name="isKeychainActivationWithEmailTokenOn8ball"]');
			var ssoInterstitial = document.querySelector('#continueInterstitial');

			// if its the submit of sso interstitial, do not do anything
			if (ssoInterstitial) {
				eventPreventDefault(event);
				return;
			}
			if (enableSuppressAutoSubmit && timeLapseForAutoSubmit) {
				login.logger.log({
					evt: autoSubmitCalType,
					data: 'PREPARE_SUPPRESS_' + timeLapseForAutoSubmit,
					calEvent: true
				});
				login.logger.pushLogs();
				if (shouldSuppressForSubmit) {
					eventPreventDefault(event);
					delete window.formAutofilledAt;
					return;
				}
			}

			var splitLoginContext = document.querySelector('input[name=splitLoginContext]');
			var splitLoginCookiedFallback = document.querySelector('input[name=splitLoginCookiedFallback]');
			var splitLoginContextVal = (splitLoginContext && splitLoginContext.value) || '';
			if (splitLoginCookiedFallback || isKeychainActivationWithEmailTokenOn8ball) {
				onClickSubmitBtnHandler(event);
			} else if (splitLoginContextVal === 'inputEmail' || splitLoginContextVal === 'inputPhone' ||
				login.utils.isPrefilledEmailNext() || login.utils.isPrefillEmailEnabled()) {
				onClickNextBtnHandler(event);
			} else {
				onClickSubmitBtnHandler(event);
			}
		}

		function updatePhoneOnButtonClick(phone) {
			var strippedPhone = stripPhoneCountryCodeIfExists(phone);
			phoneDom.field.value = strippedPhone;
			emailDom.field.value = strippedPhone;
		}

		/**
		 * Handle next for split login user
		 * This is called when with the email (or phone) field is submitted
		 * @param {Object} event Mouse Click Event
		 */
		function onClickNextBtnHandler(event) {
			var isValidInput;
			var splitLoginContext = login.utils.getSplitLoginContext();
			var isSafari = $('body').data('loginExperience') === 'safari';
			// isSafariAutofill only detect uncookied user who prefilled password on email page
			var autofilledPasswordField = login.utils.isFieldPrefilled(document.querySelector('#password'));
			var isSafariAutofill = isSafari && autofilledPasswordField;
			if (login.utils.isPrefillEmailEnabled() && splitLoginContext.value !== 'inputEmail' && login.utils.isTpdDemo()) {
				eventPreventDefault(event);
				return login.tpdLogin && login.tpdLogin.attemptTpdLogin('autoSend');
			}
			if (!isHybrid) {
				isValidInput = loginType === 'email' ? isValidUserId(emailDom) : isValidPhone(phoneDom);
			} else {
				if (loginType === 'phone' && emailDom.field) {
					updatePhoneOnButtonClick(emailDom.field.value);
				}
				isValidInput = loginType === 'email' ? isValidUserId(emailDom) : isValidPhone(emailDom);
			}
			var formFields = document.querySelectorAll('form[name=login] input');
			var formData = {};
			formData.isSafariAutofill = isSafariAutofill;
			var captchaDom = login.utils.getActiveCaptchaElement(splitLoginContextField);
			var rememberProfileCb = getActiveRememberProfileElement(splitLoginContextField);
			var splitPasswordClientTransition = $('body').data('splitPasswordClientTransition');
			var phone, phoneValue, phoneCode, target;
			var phoneCodeDom = document.querySelector('#phoneCode');
			validateOnKeyUp = true;

			eventPreventDefault(event);

			if (isValidInput && $(emailDom.field).hasClass('validate') && splitLoginContext === 'inputEmail') {
				isValidInput = validateEmail(emailDom);
			}
			if (isValidInput && captchaDom && captchaDom.field) { // Captcha was shown
				isValidInput = validateFieldHasValue(captchaDom);
			}
			// Log the state_name in FPTI SS
			// FPTI SS logging the click of the Next button
			// TODO once server call is enabled, log this in the server side.
			// Log the transition_name as process_next only when splitLoginContext is email or phone
			if (isValidInput && (splitLoginContext === 'inputEmail' || splitLoginContext === 'inputPhone')) {
				login.logger.log({
					evt: 'state_name',
					data: login.logger.getStateName(),
					instrument: true
				});
				// log the new transition in FPTI SS
				login.logger.log({
					evt: 'transition_name',
					data: 'process_next',
					instrument: true
				});
				login.logger.pushLogs();
			}
			if (isValidInput) {
				login.utils.showSpinner();
				login.fn.addFnSyncData();
			} else {
				return;
			}

			// once the validations upon clicking "Next are done
			// If phonePasswordEnabled and phone is entered, add phone recovery information in the pwrLink
			if (loginType === 'phonePassword' || loginType === 'phone') {
				updatePwrForRecoveryUsingPhone();
			}

			// Remove page level notification if any
			if (notifications) {
				$(notifications).text('');
			}

			// Conditionally support the feature of transitioning phone to pin/password screen from client side itself
			// without making any server call
			if (splitPasswordClientTransition && (loginType === 'phone' || loginType === 'phonePassword')) {
				// Initialize phone specific data if present
				phone = document.querySelector('#phone');
				phoneValue = phone && phone.value.replace(STRIP_SYMBOLS_FROM_PHONE, '');
				phoneCode = document.querySelector('#phoneCode');
				phoneCode = phoneCode && phoneCode.value.replace(/[A-Z\s]/ig, '');
				// Set the formatted phone value in the dom field.
				phone.value = phoneValue;
				login.storeInstance.updateModel({
					splitLoginContext: (phonePinEnabled) ? 'inputPin' : 'inputPassword',
					profile: {
						phone: phoneValue,
						phoneCode: phoneCode
					}
				});
				// TODO log CPL data here
				// Log the state_name in FPTI SS
				login.logger.log({
					evt: 'state_name',
					data: 'begin_phone',
					instrument: true
				});
				// log the new transition in FPTI SS
				login.logger.log({
					evt: 'transition_name',
					data: phonePinEnabled ? 'prepare_pin' : 'prepare_pwd',
					instrument: true
				});
				login.logger.pushLogs();
				login.utils.hideSpinner();
				login.utils.setSliderToPasswordContainer();
				return;
			}
			// Conditionally support the feature of transitioning email to password screen from client side itself
			// without making any server call
			if (splitPasswordClientTransition && loginType === 'email') {
				login.storeInstance.updateModel({
					splitLoginContext: 'inputPassword',
					profile: {
						email: emailDom && emailDom.field && emailDom.field.value
					},
					rememberProfile: rememberProfileCb && rememberProfileCb.checked
				});
				login.utils.hideSpinner();
				login.utils.setSliderToPasswordContainer();
				return;
			}
			// Make XHR login call with email only
			// Collect form fields in an object
			for (var i = 0; i < formFields.length; i++) {
				formData[formFields[i].name] = formFields[i].value;
			}
			// Do not send the password or pin field in the request - they are needed only on pwd submit
			// Since this on click of Next which will only collect public credential of the user
			delete formData.login_password;
			delete formData.login_pin;

			if (formData.splitLoginContext === 'inputPhone' && phoneCodeDom) {
				formData.phoneCode = phoneCodeDom.value;
				// delete login_email since its phone login
				delete formData.login_email;
			}

			if (formData.splitLoginContext === 'inputEmail') {
				delete formData.login_phone;
				delete formData.phoneCode;
			}

			// Process on Next click for hybrid login.
			if (isHybrid) {
				if (formData.splitLoginContext === 'inputPassword' && formData.login_phone) {
					formData.phoneCode = phoneCodeDom.value;
				}
				// Disable either phone or email fields based on splitLoginContext. That way some browsers
				// will not autofill disabled fields.
				if (formData.splitLoginContext === 'inputPhone' && emailDom.field) {
					emailDom.field.setAttribute('disabled', 'disabled');
					emailDom.field.value = '';
				} else if (formData.splitLoginContext === 'inputEmail' && phoneDom.field) {
					phoneDom.field.setAttribute('disabled', 'disabled');
					phoneDom.field.value = '';
				}
			}

			// override captcha value in payload
			// note: there is more than one captcha element in the DOM
			if (captchaDom && captchaDom.field) {
				formData.captcha = captchaDom.field.value;
			}

			// Override remember-profile checkbox value in payload
			// Note: there is more than one remember-profile checkbox element in the DOM
			if (rememberProfileCb) {
				formData.rememberProfile = rememberProfileCb.checked;
			}

			// New in-context Checkout sdkMeta query params passed in URL
			// Old in-context Checkout does not pass sdkMeta query params in URL so need client-side determination
			if(login.utils.isInContextIntegration()){
				formData.isInContextCheckout = true;
			}

			target = getEventTarget(event);

			$.ajax({
				url: loginForm.getAttribute('action'),
				data: formData,
				success: login.utils.successfulXhrHandler,
				fail: login.utils.failedXhrSubmitHandler
			});
		}

		/**
		 * It sets whatever value is displayed in a profile to phone or email fields.
		 * This is necessarry to make sure that e.g. Safari will only prefill the password field and don't change
		 * anything else, like hidden input fields from the previous page.
		 */
		function setPhoneAndEmailFieldsFromProfile() {
			var splitLoginCookiedFallback = document.querySelector('input[name="splitLoginCookiedFallback"]');
			var phoneField = document.querySelector('#phone');
			var emailField = document.querySelector('#email');
			var profileDisplayEmailField = document.querySelector('.profileDisplayEmail');
			var publicIdentifierValue = profileDisplayEmailField && profileDisplayEmailField.innerHTML;
			// If it's cookied fallback or there is no public credential in profile, don't change anything.
			if (!publicIdentifierValue || splitLoginCookiedFallback || !(emailField && phoneField)) {
				return;
			}
			if (emailField.hasAttribute('disabled') && !phoneField.hasAttribute('disabled')) {
				phoneField.value = publicIdentifierValue;
				emailField.value = '';
			} else if (!emailField.hasAttribute('disabled') && phoneField.hasAttribute('disabled')) {
				emailField.value = publicIdentifierValue;
				phoneField.value = '';
			}
		}

		function disablePhoneOrEmailFieldByActiveLoginType() {
			if (loginType === 'email') {
				phoneDom && phoneDom.field && phoneDom.field.setAttribute('disabled', 'disabled');
			} else {
				emailDom && emailDom.field && emailDom.field.setAttribute('disabled', 'disabled');
			}
		}

		/**
		 * Track if the user used an autofill feature of a browser or an extension
		 * If the autofill is detected to the password field, an hidden element will be added to the login form
		 * At this time of implementation, only Safari's keychain autofill can be tracked.
		 */
		function trackPasswordFieldAutofill() {
			var loginForm = document.querySelector('form[name=login]');
			var passwordField = document.querySelector('#password');
			var btnLogin = document.querySelector('#btnLogin');
			var isWebkitAutofillPseudoClassAdded = passwordField.matches(':-webkit-autofill');

			/**
			 * When a field is auto-filled, a special pseudo class is added to an element by a browser.
			 * The pseudo class name varies by browsers. For example, for Safari and Chrome, ':webkit-autofill'.
			 * Once the autofill pseudo class addition is detected, relevant flags will be sent to the backend through form data.
			 */
			if (isWebkitAutofillPseudoClassAdded && Object.prototype.hasOwnProperty.call(window, 'getComputedStyle')) {
				var computedStyleOfPasswordField = window.getComputedStyle(passwordField);
				var computedBackgroundColor = computedStyleOfPasswordField.backgroundColor; // default value is 'rgb(255, 255, 255)'
				var parsedBackgroundColor = (computedBackgroundColor.match(/[0-5]{1,3}/g) || []).join(',');
				login.utils.addHiddenElement('passwordFieldAutofillColor', parsedBackgroundColor, loginForm);
			}
		}

		/*
         * Get payload from form fields
         * @param {Object[]|Object} formFields
         * @param {string} captchaValue
         * @param {boolean} rmProfileChecked
         * @param {boolean} isHybrid
         * @return {Object}
         */
		function getPayloadFromFormFields(formFields, captchaValue, rmProfileChecked, isHybrid) {
			var profileDisplayPhoneCode = document.querySelector('.profileDisplayPhoneCode');
			var otCheckboxDOM = document.querySelector('#keepMeLoggedIn');
			var isOtCheckboxChecked = otCheckboxDOM && otCheckboxDOM.checked;
			var phoneCodeEl = document.querySelector('#phoneCode');
			var formData = {};
			for (var i = 0; i < formFields.length; i++) {
				if(formFields[i].disabled) {
					continue;
				}
				formData[formFields[i].name] = formFields[i].value;
			}
			if (isOtCheckboxChecked) {
				formData.rememberMe = 'true';
			} else {
				delete formData.rememberMe;
			}

			// delete login_email since its phone login
			if (formData.splitLoginContext === 'inputPassword' && formData.login_phone && phoneCodeEl) {
				formData.phoneCode = phoneCodeEl.value;
				delete formData.login_email;
			}

			// delete login_phone and phoneCode since its email login
			if (formData.splitLoginContext === 'inputPassword' && !formData.login_phone &&
				profileDisplayPhoneCode && profileDisplayPhoneCode.textContent === '') {
				delete formData.login_phone;
				delete formData.phoneCode;
			}

			// Process on Next click for hybrid login.
			if (isHybrid) {
				if (formData.splitLoginContext === 'inputPassword' && formData.login_phone && profileDisplayPhoneCode && profileDisplayPhoneCode.textContent !== '') {
					formData.phoneCode = profileDisplayPhoneCode.textContent;
				}
			}
			return formData;
		}

		/**
		 * Handle response case of loginWithXhr promise
		 * @param {Object} res
		 */
		function handleLoginWithXhrResponse(res) {
			res = res || {};
			var keychainInterstitial = document.querySelector('#keychain-interstitial');
			var activeContent = document.querySelector('#content');
			var isSuaRequired = res.isSuaRequired;
			var isKeychainOptinRequired = res.isKeychainOptinRequired;
			var returnUrl = res.returnUrl || '/signin' ;
			btnLogin && btnLogin.removeAttribute('disabled');
			if(returnUrl) {
				document.body.setAttribute('data-return-url', returnUrl);
			}

			if (login.overlayUtils.isEligibleToShowOverlay(res) && !(res.notifications && res.notifications.msg)) {
				login.logger.log({
					evt: XHR_LOGIN_CAL_TYPE,
					data: 'XHR_LOGIN_SUCCESS',
					calEvent: true
				});
				login.logger.pushLogs();
				return login.overlayUtils.showOverlay(res);
			}

			if (isSuaRequired && returnUrl) {
				login.utils.hideSpinner();
				login.utils.hideSpinnerMessage();
				login.logger.log({
					evt: XHR_LOGIN_CAL_TYPE,
					data: 'XHR_LOGIN_SUCCESS',
					calEvent: true
				});
				login.logger.pushLogs();
				return login.sua(res);
			}

			/**
			 * If keychainDeviceToken is received on response, proceed the Keychain optin
			 */
			if (isKeychainOptinRequired && returnUrl) {
				login.utils.hideSpinner();
				login.utils.hideSpinnerMessage();
				keychainInterstitial && $(keychainInterstitial).removeClass('hide');
				activeContent && $(activeContent).addClass('hide');
				login.logger.log({
					evt: XHR_LOGIN_CAL_TYPE,
					data: 'XHR_LOGIN_SUCCESS',
					calEvent: true
				});
				login.logger.pushLogs();
				return login.keychain(res);
			}

			/**
			 * Otherwise, redirect to Hermes
			 */
			if (returnUrl && !res.notifications) {
				// return to hermes for keychain not-eligible account
				login.logger.log({
					evt: XHR_LOGIN_CAL_TYPE,
					data: 'XHR_LOGIN_SUCCESS',
					calEvent: true
				});
				login.logger.pushLogs();
				return window.location.href = returnUrl;
			}

			/**
			 * Show error messages if notification is present on response
			 */
			if (!res.showSpinnerUpfront) {
				login.utils.hideSpinner();
				login.utils.hideSpinnerMessage();
			}
			if (res.notifications && res.notifications.msg) {
				var notifications = document.querySelector('.notifications');
				var notificationsMsg = document.createElement('p');
				notificationsMsg.innerHTML = res.notifications.msg;
				notificationsMsg.className += 'notification ' + (res.notifications.type || '');
				notificationsMsg.setAttribute('role', 'alert');
				notifications.innerHTML = '';
				notifications.appendChild(notificationsMsg);
			}
			if (passwordDom.field) {
				passwordDom.field.value = ''; // remove password when login failed
			}

			var emailPageSwitch = document.querySelector('#emailPageSwitch');
			if (emailPageSwitch) {
				addEvent(emailPageSwitch, 'click', function(event) {
					eventPreventDefault(event);
					loginType = 'email';
					login.utils.switchToEmailHandler(event);
				});
			}
			login.logger.log({
				evt: XHR_LOGIN_CAL_TYPE,
				data: 'XHR_LOGIN_FAILURE',
				calEvent: true
			});

			if (login.otp) {
				login.otp.prepareSendPage(res);
			}

			login.geoEnablement && login.geoEnablement.setGeoMessage(res);

			return login.logger.pushLogs();
		}

		/**
		 * Handle error case of loginWithXhr promise
		 */
		function handleLoginWithXhrError() {
			login.utils.hideSpinner();
			login.utils.hideSpinnerMessage();
			btnLogin && btnLogin.removeAttribute('disabled');
			if (passwordDom.field) {
				passwordDom.field.value = ''; // remove password when login failed
			}
			login.logger.log({
				evt: XHR_LOGIN_CAL_TYPE,
				data: 'XHR_FAILED',
				calEvent: true
			});
			login.logger.pushLogs();
			login.utils.failedXhrSubmitHandler();
		}

		function loginWithXhr(data) {

			var data = data || {};
			data['_csrf'] = document.querySelector('#token').value
			login.utils.showSpinner();

			$.ajax({
				type: 'POST',
				url: '/signin',
				data: data,
				dataType: 'json',
				success: function(response) {
					if (response) {
						login.utils.setCSRFToken(response['_csrf']);
						return handleLoginWithXhrResponse(response);
					} else {
						return handleLoginWithXhrError();
					}
				},
				fail: function(err) {
					return handleLoginWithXhrError(err);
				}
			});
		}

		function isEligibleForLoginXhr() {
			// @type {KeychainFlags}
			var keychainFlags = login.utils.parseJsonSafe($('body').data('keychainFlagsJson')) || {};
			var isKeychainEligibleForXhrLogin = keychainFlags.isEligibleForXhrLogin;
			var isKeychainActivationWithEmailTokenOn8ball = document.querySelector('input[name="isKeychainActivationWithEmailTokenOn8ball"]');
			var appleIdpJsonDOM = document.querySelector('input[name="appleIdpJson"]') || {};
			var appleIdpJson = login.utils.parseJsonSafe(appleIdpJsonDOM.value) || {};

			if(login.utils.isCookieDisabledBrowser() || appleIdpJson.isOptin) {
				return false;
			}

			if ($('body').data('webAuthnOptinEligible')) {
				return false;
			}

			if(login.overlayUtils.isLoginXHREligbleForOverlay()) {
				return true;
			}

			return isKeychainEligibleForXhrLogin && !isKeychainActivationWithEmailTokenOn8ball;
		}

		/**
		 * Handle form submit by calling appropriate validator function based on email/password or phone/pin
		 * @param {Object} event Mouse Click Event
		 */
		function onClickSubmitBtnHandler(event) {
			var isValidInput;
			var profileRememberedEmail = document.querySelector('.profileRememberedEmail');
			var isTrackPasswordFieldAutofillEnabled = $('body').data('isTrackPasswordFieldAutofillEnabled');
			var transitioningDiv = document.querySelector('.transitioning');
			var formFields = document.querySelectorAll('form[name=login] [name]:not(button)') || {};
			var captchaDom = login.utils.getActiveCaptchaElement(splitLoginContextField);
			var rememberProfileCb = getActiveRememberProfileElement(splitLoginContextField);

			if (isHybridEditableOnCookied && loginType === 'phone' && emailDom.field) {
				updatePhoneOnButtonClick(emailDom.field.value);
			} else {
				setPhoneAndEmailFieldsFromProfile();
			}
			validateOnKeyUp = true;

			// TODO clean this up once non split is killed.
			function validatePhoneLogin() {
				// The validation logic on phone can vary to validate phone or pin, based on splitLogin context
				// or based on email or phone loginType in case of non split pages
				var splitContext = splitLoginContextField && splitLoginContextField.value;
				// return early if phoneDom is not present to avoid any unexpected errors upon alidation
				if (!phoneDom.field) {
					return;
				}

				if (isHybridEditableOnCookied) {
					isValidInput = isValidPhone(emailDom) && passwordDom.field &&
						validateRequiredFields(phoneDom, passwordDom);
				} else if (splitContext === 'inputPassword') {
					// Validation for split password page
					isValidInput = passwordDom.field && validateRequiredFields(phoneDom, passwordDom);
				} else {
					// Validation in case of non split phone pin or split pin (no password supported in non split)
					isValidInput = pinDom.field && validateRequiredFields(phoneDom, pinDom);
				}
			}

			// validate email password on submit
			if (loginType === 'email') {
				isValidInput = isValidUserId(emailDom) && validateRequiredFields(emailDom, passwordDom);
				// Do not apply email format rule from the input password page
				if (!profileRememberedEmail && isValidInput && $(emailDom.field).hasClass('validate')) {
					isValidInput = validateEmail(emailDom);
				}
			} else {
				// Validate phone pin / password on submit
				validatePhoneLogin();
			}

			if (isTrackPasswordFieldAutofillEnabled) {
				trackPasswordFieldAutofill();
			}

			// Check to see if javascript has fully loaded before sending request to login
			if (document.readyState !== 'complete') {
				return setTimeout(function () {
					onClickSubmitBtnHandler(event);
				}, 10);
			}

			// Proceed to form submit
			if (isValidInput) {
				if (stsPublicKey) {
					if (loadingEncryptionSetup || currentlyEncrypting) {
						return setTimeout(function () {
							onClickSubmitBtnHandler(event)
						}, 10);
					}

					allowEncryption = false;

					passwordDom.field.value = encryptedPassword;
					passwordDom.field.name = "encrypted_password";

					login.logger.log({
						evt: "GEO_ENABLEMENT",
						data: "LOGIN_WITH_ENCRYPTED_PASSWORD",
						calEvent: true,
					});
					login.logger.log({
						evt: 'login_password_type',
						data: 'encrypted_password',
						instrument: true
					});
				}
				if (isHybridEditableOnCookied) {
					disablePhoneOrEmailFieldByActiveLoginType();
				}

				login.utils.showSpinner();
				login.utils.showSpinnerMessage();
				login.fn.addFnSyncData();
				eventPreventDefault(event);

				if (isEligibleForLoginXhr()) {

					login.logger.log({
						evt: 'login_type',
						data: 'xhr',
						instrument: true
					});
					login.logger.log({
						evt: UNIFIED_LOGIN_CAL_TYPE,
						data: 'LOGIN_TYPE_XHR',
						calEvent: true
					});
					login.logger.pushLogs();

					$(transitioningDiv).addClass('nonTransparentMask');
					login.utils.showSpinnerMessage('checkingInfo');

					var captchaValue = (captchaDom && captchaDom.field) ? captchaDom.field.value : null;
					var rmProfileChecked = rememberProfileCb ? rememberProfileCb.checked : null;
					var data = getPayloadFromFormFields(formFields, captchaValue, rmProfileChecked, isHybrid);

					return loginWithXhr(data);
				}

				login.logger.log({
					evt: 'login_type',
					data: 'form_submit',
					instrument: true
				});
				login.logger.log({
					evt: UNIFIED_LOGIN_CAL_TYPE,
					data: 'LOGIN_TYPE_FORM_SUBMIT',
					calEvent: true
				});
				login.logger.pushLogs();
				// Submit the form to the server manually by calling form.submit().
				// The submit event is not generated. It is assumed that if the programmer
				// calls form.submit(), then the script already did all related processing.
				loginForm && loginForm.submit();
				// Preventing users from submitting the login multiple times for a safe submit
				setTimeout(function() {
					btnLogin.setAttribute('disabled', 'disabled');
				}, 10);
			} else {
				eventPreventDefault(event);
			}
		}

		/**
		 * Handle key up events on email, password, phone and pin (only if user had clicked submit)
		 */
		function onFieldKeyUpHandler(dom) {
			var trimmedValue;
			if (!validateOnKeyUp) {
				return false;
			}

			trimmedValue = dom.field.value.replace(EMPTY_PTN, '');
			if (trimmedValue === '') {
				showRequiredError(dom);
				if (dom.type === 'email') {
					hideInvalidError(dom);
				}
				return;
			} else {
				hideRequiredError(dom);
			}

			if (dom.type === 'email' && $(dom.field).hasClass('validate')) {
				if (trimmedValue.match(EMAIL_PTN)) {
					hideInvalidError(dom);
					hideError(dom, true);
				} else {
					showError(dom);
					showInvalidError(dom);
				}
			} else {
				hideError(dom, true);
			}
		}

		/**
		 * Handle blur events on email, password, phone and pin
		 */
		function onFieldBlurHandler(dom) {
			validateOnKeyUp = false;
			hideError(dom);
		}

		/**
		 * Handle on focus events on email, password, phone, pin and captcha
		 */
		function onFieldFocusHandler(dom) {
			if ($(dom.container).hasClass('hasError')) {
				validateOnKeyUp = true;
			} else {
				validateOnKeyUp = false;
			}
		}

		/**
		 * Validate and return the default login type
		 * @returns {*}
		 */
		function getDefaultLoginType() {
			var hasPhoneValue = phoneDom.field && phoneDom.field.value; // That's used for hybrid login.
			if (phoneDom.field && $(phoneDom.field).attr('type') !== 'hidden' &&
				(emailDom.field && emailDom.field.hasAttribute('disabled') ||
					splitLoginContextField && splitLoginContextField.value === 'inputPhone')) {
				return phonePinEnabled ? 'phone' : 'phonePassword';
			} else if ((splitLoginContextField && splitLoginContextField.value === 'inputPin') || hasPhoneValue) {
				return 'phone';
			} else {
				return 'email';
			}
		}

		function playCaptchaAudio(event) {
			var captchaDom = login.utils.getActiveCaptchaElement(splitLoginContextField);
			var audioTag = captchaDom.audioTag;
			var audioSupport = !!(audioTag.canPlayType && audioTag.canPlayType('audio/mpeg').replace(/no/, ''));

			if (audioSupport) {
				eventPreventDefault(event);
				// Set the focus to captcha field prior to playing the audio.
				captchaDom.field.focus();
				audioTag.play();
			} else {
				// Open in new tab or page based on browser
				return true;
			}
		}

		function refreshCaptcha(event) {
			var captchaDom = login.utils.getActiveCaptchaElement(splitLoginContextField);
			eventPreventDefault(event);
			eventStopPropagation(event);
			$.ajax({
				type: 'POST',
				url: '/signin/refreshCaptcha',
				data: {
					'_csrf': document.querySelector('#token').value
				},
				dataType: 'json',
				success: function(response) {
					if (response && response.captcha) {
						captchaDom.image.setAttribute('src', response.captcha.captchaImgUrl);
						captchaDom.audioTag.setAttribute('src', response.captcha.captchaAudioUrl);
						captchaDom.playAudioBtn.setAttribute('href', response.captcha.captchaAudioUrl);
						captchaDom.field.value = '';

						// Set focus on captcha input field only in desktop browser
						if ($('body').hasClass('desktop')) {
							captchaDom.field.focus();
						}
					}
				}
			});
		}

		/**
		 * Toggle sc tracking classes on click of Remember Profile checkbox
		 */
		function onRememberProfileClickHandler(event) {
			var checkBox = getEventTarget(event);
			if (!checkBox) {
				return;
			}

			// Toggle the class with a short delay to prevent the tracking call from picking the change
			// instead of the pre-toggle value
			setTimeout(function() {
				if ($(checkBox).hasClass('scTrack:unifiedlogin-rememberme-profile-opt-in')) {
					$(checkBox).removeClass('scTrack:unifiedlogin-rememberme-profile-opt-in');
					$(checkBox).addClass('scTrack:unifiedlogin-rememberme-profile-opt-out');
				} else {
					$(checkBox).removeClass('scTrack:unifiedlogin-rememberme-profile-opt-out');
					$(checkBox).addClass('scTrack:unifiedlogin-rememberme-profile-opt-in');
				}
			}, 10);
		}

		// Attach events for email and password fields
		if (emailDom.field) {
			emailDom.field.onkeyup = onFieldKeyUpHandler.bind(null, emailDom);
			emailDom.field.onblur = onFieldBlurHandler.bind(null, emailDom);
			emailDom.field.onfocus = onFieldFocusHandler.bind(null, emailDom);
		}

		if (passwordDom.field) {
			passwordDom.field.onkeyup = onFieldKeyUpHandler.bind(null, passwordDom);
			passwordDom.field.onblur = onFieldBlurHandler.bind(null, passwordDom);
			passwordDom.field.onfocus = onFieldFocusHandler.bind(null, passwordDom);
		}

		// Attach events for phone and pin fields (only if they exist)
		if (phoneDom.field) {
			phoneDom.field.onkeyup = onFieldKeyUpHandler.bind(null, phoneDom);
			phoneDom.field.onblur = onFieldBlurHandler.bind(null, phoneDom);
			phoneDom.field.onfocus = onFieldFocusHandler.bind(null, phoneDom);
		}
		if (pinDom.field) {
			pinDom.field.onkeyup = onFieldKeyUpHandler.bind(null, pinDom);
			pinDom.field.onblur = onFieldBlurHandler.bind(null, pinDom);
			pinDom.field.onfocus = onFieldFocusHandler.bind(null, pinDom);
		}

		if (phoneCodeDom && phoneCodeDom.field) {
			phoneCodeDom.field.onchange = onPhoneCodeChangeEventHandler;
			if (isHybrid) {
				phoneCodeDom.field.onclick = onPhoneCodeClickEventHandler;
			}
		}

		// Loop over all captcha elements to bind events to
		// TODO: Improve this code by using Event Delegation instead OR avoid multiple similar DOM elements
		function bindCaptchaEventHandlers() {
			var wrappers = document.querySelectorAll('.captcha-container');
			for (var i = 0; i < wrappers.length; i++) {
				bindHandlers(login.utils.getCaptchaDom(wrappers[i]));
			}

			function bindHandlers(captchaDom) {
				captchaDom.playAudioBtn.onclick = playCaptchaAudio;
				captchaDom.refreshCaptchaBtn.onclick = refreshCaptcha;
				captchaDom.field.onkeyup = onFieldKeyUpHandler.bind(null, captchaDom);
				captchaDom.field.onblur = onFieldBlurHandler.bind(null, captchaDom);
				captchaDom.field.onfocus = onFieldFocusHandler.bind(null, captchaDom);
			}
		}
		bindCaptchaEventHandlers();

		// Hide education message on close button click
		function removeEducationInfo(event) {
			var target = getEventTarget(event);
			var educationMessage, contentContainer, removeMsgInput;

			// Return early if this function does not apply to the clicked element
			if (!target || target.id !== 'iconCloseEducation') {
				return;
			}

			educationMessage = document.querySelector('.educationMessage');
			if (!educationMessage) {
				return;
			}

			contentContainer = document.querySelector('.contentContainer');

			$(educationMessage).addClass('hide');
			if (contentContainer) {
				$(contentContainer).removeClass('contentContainerShort');
			}

			// Add hidden input, so server side can decide to stop showing the education message
			removeMsgInput = document.createElement('input');
			removeMsgInput.setAttribute('type', 'hidden');
			removeMsgInput.setAttribute('name', 'removeEducationMsg');
			removeMsgInput.setAttribute('value', 'true');
			$(loginForm).append(removeMsgInput);
		}

		// Attach events for toggling between email/password and phone/pin (only if applicable)
		if (emailIcon && phoneIcon) {
			emailIcon.onclick = enableEmailPassword;
			phoneIcon.onclick = enablePhonePin;
		} else if (emailIcon) {
			// In case of mobile ID login we would only have emailIcon and not phoneIcon
			// and we have a different event listener
			emailIcon.onclick = switchToSplitEmailFromPasswordPage;
		}

		// Attach events to switch the split screen between email and phone
		if (phonePasswordEnabled && switchToPhoneLink) {
			switchToPhoneLink.onclick = switchToPhoneLogin;
		}
		if (phonePasswordEnabled && switchToEmailLink) {
			switchToEmailLink.onclick = switchToEmailLogin;
		}

		addEvent(countryPhoneSelectWrapper, 'focusin', function(event) {
			$(countryPhoneSelectWrapper).addClass('focus');
		});
		addEvent(countryPhoneSelectWrapper, 'focusout', function(event) {
			$(countryPhoneSelectWrapper).removeClass('focus');
		});
		if (emailPageSwitch) {
			addEvent(emailPageSwitch, 'click', function(event) {
				eventPreventDefault(event);
				loginType = 'email';
				login.utils.switchToEmailHandler(event);
			});
		}

		// Attach event for the button that submits the login
		addEvent(loginForm, 'keydown', function(event) {
			// Check to see if the enter key was pressed
			// Submit the form if the intention was to not switch to phone
			var target = getEventTarget(event);
			if (isEnterKeyPressed(event) && (!target.href) && !$(target).hasClass('show-hide-password')) {
				onFormSubmitHandler(event);
			}
		});
		addEvent(loginForm, 'submit', onFormSubmitHandler);

		// click on "Approve login using mobile device"
		if (moreOptionsMobileLink) {
			addEvent(moreOptionsMobileLink, 'click', clickTpdHandler);
		}
		if (tpdButton) {
			addEvent(tpdButton, 'click', clickTpdHandler);
		}
		if (backToInputEmailLink) {
			addEvent(backToInputEmailLink, 'click', function(event) {
				backToInputEmailClickHandler(event, function() {
					var startOnboardingFlowWithoutForcedSignup = document.querySelector('.onboardingFlowContentKey');
					var startGuestOnboardingFlowWithoutForcedSignup = document.querySelector('.pwdContentKey');
					var pwdContentKeyExists = $('body').data('pwdContentKeyExists');
					if(pwdContentKeyExists) {
						$(startOnboardingFlowWithoutForcedSignup).removeClass('hide');
						$(startGuestOnboardingFlowWithoutForcedSignup).addClass('hide');
					}
				});
				if (isHybrid) {
					resetForm();
				}
			});
		}

		if (ssoInterstitialBackToInputEmailLink) {
			addEvent(ssoInterstitialBackToInputEmailLink, 'click', function(event) {
				backToInputEmailClickHandler(event, function() {
					var ssoInterstitialContainer = document.querySelector('#ssoInterstitialContainer');
					var contentContainer = $('#content');
					if (ssoInterstitialContainer && contentContainer) {
						ssoInterstitialContainer.remove(); // remove sso interstitial
						contentContainer.removeClass('hide'); // show email/password page
					}
					if (isHybrid) {
						resetForm();
					}
				});
			});
		}

		if (backToEmailPasswordLink) {
			addEvent(backToEmailPasswordLink, 'click', function(event) {
				event.preventDefault();
				if (splitLoginCookiedFallback) {
					enableEmailPassword();
				} else {
					backToInputEmailClickHandler(event);
				}
			});
		}

		function clickTpdHandler(event) {
			var isValidInput = loginType === 'email' ? isValidUserId(emailDom) : isValidPhone(phoneDom);
			var tpdEventTarget = getEventTarget(event);
			eventPreventDefault(event);
			login.tpdLogin && login.tpdLogin.instrumentTpdLoginClicked(tpdEventTarget.id);
			// TPD survey bubble only appears when PN is auto-send
			// For TPDAutosend user who click More Options->Tpd, we set TPDSurveyEnabled to false
			// To stop showing the survey bubble when they click usePWInstead
			document.body.setAttribute('data-tpd-survey-enabled', false);
			if (isValidInput && $(emailDom.field).hasClass('validate')) {
				isValidInput = validateEmail(emailDom);
			}
			if (!isValidInput) {
				return;
			}

			login.tpdLogin && login.tpdLogin.attemptTpdLogin(tpdEventTarget.id);
		}

		function backToInputEmailClickHandler(event, callback) {
			updatePwrForRecoveryUsingEmail();
			loginType = 'email';
			login.utils.notYouClickHandler(event, callback);
			// Hide the dom errors if any
			emailDom.container && hideError(emailDom, true);
			passwordDom.container && hideError(passwordDom, true);
			phoneDom.container && hideError(phoneDom, true);
			pinDom.container && hideError(pinDom, true);
		}
		if (rememberProfileCheckBox) {
			rememberProfileCheckBox.onclick = onRememberProfileClickHandler;
		}

		function onSamlSsoLoginClickEventHandler() {
			login.logger.log({
				evt: 'user_action',
				data: 'saml_link_clicked',
				instrument: true
			});
			login.logger.pushLogs();
		}

		// Subscribe methods to top level click
		if (login.pubsub) {
			login.pubsub.subscribe('WINDOW_CLICK', removeEducationInfo);
		}
	}
}());

// One Touch login utils
login.oneTouchLogin = (function() {
	var utils = login.utils;
	var loadResources = login.loadResources;
	var logger = login.logger;
	var ulData = window.PAYPAL.ulData || {};
	var calEventType = 'ONETOUCH_LOGIN';
	var intent = utils.getIntent();

	function logClientSideData() {
		var clientLogList = [];
		var currentLang = document.querySelector('input[name="locale.x"]');

		clientLogList.push({evt: 'state_name', data: 'Login_UL_RM', instrument: true});
		clientLogList.push({evt: 'transition_name', data: 'prepare_login_UL_RM', instrument: true});
		clientLogList.push({evt: 'design',
			data: utils.isInContextIntegration() ? 'in-context' : 'full-context', instrument: true});
		if (currentLang) {
			clientLogList.push({evt: 'page_lang', data: currentLang.value, instrument: true});
		}
		clientLogList.push({evt: calEventType, data: 'PREPARE_PAGE_' + intent.toUpperCase(), calEvent: true});
		logger.clientLog(clientLogList, null);
	}
	function updatePageLevelError(msg, msgTyp) {
		var notificationContainer = document.querySelector('.notifications');
		var paraEle, notificationMsg;

		if (notificationContainer) {
			paraEle = document.createElement('p');
			notificationMsg = document.createTextNode(msg);

			paraEle.setAttribute('class', 'notification ' + msgTyp);
			paraEle.setAttribute('role', 'alert');

			paraEle.appendChild(notificationMsg);
			notificationContainer.appendChild(paraEle);
		}
	}

	// Private method to attempt one touch login and handle the flow navigation
	function doOneTouchLogin() {
		// Get all of the hidden login form input element (except any of public credential field)
		var loginFormInputList = document.querySelectorAll('form[name=login] input[type=hidden]');
		var loginEmail = document.querySelector('input[name=login_email]');
		var loginPassword = document.querySelector('input[name=login_password]');
		var oneTouchUser = $('body').data('oneTouchUser');
		var oneTouchTenant = $('body').data('oneTouchTenant');
		var intent = login.utils.getIntent();
		var cookieBannerEnabled = $('body').data('cookieBannerEnabled');
		var isKeychainOptinRequired = $('body').data('isKeychainOptinRequired');
		var timeoutEnable = false;
		// List of form fields expected to send over JWT based login form
		var otFormInputs = {_csrf: 1, intent: 1, flowId: 1, ctxId: 1, returnUri: 1, state: 1, 'locale.x': 1, fn_sync_data: 1};
		var data = {};
		var otStartTime;

		// Iterate all the hidden form input field list
		for (var i = 0; i < loginFormInputList.length; i++) {
			if (otFormInputs[loginFormInputList[i].name]) {
				data[loginFormInputList[i].name] = loginFormInputList[i].value;
			}
		}

		// If missing of either one required parameter is not intent for one touch login
		if (!data.intent || (intent !== 'prox' && !data.returnUri) || !oneTouchUser) {
			utils.hideSpinner();
			autoLoginfallBackClientLog(); // Trigger the default client side log
			return;
		}

		// Pass the actual intent as otLoginIntent as well for scalability
		data['otLoginIntent'] = data.intent;
		data['login_email'] = loginEmail && loginEmail.value;

		if (oneTouchTenant) {
			data['oneTouchTenant'] = oneTouchTenant;
		}

		// Start to show the progress message with spinner
		utils.showSpinner();
		// Log FPTI
		logClientSideData();

		if ($('body').data('xhrTimeoutEnable') && utils.isSpinnerShown() && !utils.isUserAgentIneligibleForTimeout()) {
			timeoutEnable = true;
		}

		// hide ot checkbox for OT Login user not returning
		$('#keepMeLogin') && $('#keepMeLogin').addClass('hide');

		otStartTime = $('body').data('loadStartTime');

		$.ajax({
			url: '/signin/ot-token',
			method: 'POST',
			data: data,
			timeoutEnable: timeoutEnable,
			success: function(res) {
				var notifications;

				if (loginEmail) {
					loginEmail.removeAttribute('disabled');
				}

				if (loginPassword) {
					loginPassword.removeAttribute('disabled');
				}

				// keychainDeviceToken drops only if eligible for keychain optin
				if (res.keychainDeviceToken && login.keychain) {
					return login.keychain(res);
				}

				if (res.smartlockOptIn && login.smartLock) {
					login.smartLock(res);
					return;
				}
				if (res.incompleteContext) {
					window.location.href = window.location.href;
					return;
				}
				// Do redirect to returnUrl on success
				if (res.returnUrl) {
					login.utils.logCPLData({startTime: otStartTime , status: 'success', flowName:'One Touch'});
					window.location.href = res.returnUrl;
					return;
				}
				notifications = res.notifications;
				if (notifications) {
					updatePageLevelError(notifications.msg, notifications.type);
				}
				// In case if there is not returnUrl then show login page
				// It is not expected to happen in any case
				utils.hideSpinner();
				utils.hideSpinnerMessage('secureMessage');
				utils.hideSpinnerMessage('oneTouchMessage');
				autoLoginfallBackClientLog({error_code: 'ot_login_failed'});
				if (cookieBannerEnabled) {
					loadResources && loadResources.showCookieBanner();
				}
			},
			fail: function(status) {
				// Show login page
				utils.hideSpinner();
				login.utils.logCPLData({startTime: otStartTime , status: 'failure', flowName:'One Touch'});
				if (loginEmail) {
					loginEmail.removeAttribute('disabled');
				}

				if (loginPassword) {
					loginPassword.removeAttribute('disabled');
				}
				utils.hideSpinnerMessage('secureMessage');
				utils.hideSpinnerMessage('oneTouchMessage');
				autoLoginfallBackClientLog({error_code: 'ot_login_xhr_fail'});
				if (cookieBannerEnabled) {
					loadResources && loadResources.showCookieBanner();
				}
			}
		});
	}

	return function oneTouchLogin() {
		var oneTouchUser = $('body').data('oneTouchUser');
		var isKeychainOptinRequired = $('body').data('isKeychainOptinRequired') === 'true';
		var tpdAutoSend = $('body').data('tpdAutoSend');
		var otpCookiedAutoSend = $('body').data('otpCookiedAutoSend');
		var aPayAuth = ulData.aPayAuth;
		var isFnSyncDataEnabled = $('body').data('enableFnSyncPayloadOnOneTouch');

		if (isFnSyncDataEnabled) {
			logger.log({
				evt: 'FN_PAYLOAD',
				data: 'send_fn_sync_data',
				instrument: true
			});
			logger.pushLogs();
			login.fn.addFnSyncData();
		}

		// This is the short term approach to avoid triggering both A-Pay and One Touch login when both eligible
		if (!aPayAuth && oneTouchUser) {
			doOneTouchLogin();
			return;
		}

		if (aPayAuth && ulData.canNotMakePayment) {
			doOneTouchLogin();
			return;
		}

		// In case of no OT or APay feature supported then hide any default spinner
		if (!tpdAutoSend && !isAPaySupported() && !oneTouchUser && !isKeychainOptinRequired && !otpCookiedAutoSend) {
			utils.hideSpinner();
		}
	}
}());

// SHOW HIDE PASSWORD
login.showHidePassword = (function() {
	function initShowHide(el, baseType) {
		var btnShow = el.querySelector('.showPassword');
		var btnHide = el.querySelector('.hidePassword');
		var field = el.querySelector('.pin-password');

		function undisplayShowHideButtons () {
			$(btnShow).addClass('hide');
			$(btnHide).addClass('hide');
		}

		baseType = baseType || 'text';

		// In case of webkit browsers, base type as well as input field type will be 'tel'
		// In UL the pin is masked using a webkit specific property via special class
		// Instead of toggling between 'type' of input field, we toggle this class
		if (baseType === 'tel') {
			$(field).addClass('tel-password');
		}

		function showPassword(e) {
			if (baseType === 'tel') {
				$(field).removeClass('tel-password');
			} else {
				field.setAttribute('type', baseType);
			}
			$(btnShow).addClass('hide');
			$(btnHide).removeClass('hide');
			field.focus();

			e.stopPropagation();

			login.logger.log({
				evt: 'is_pwd_sh',
				data: 'Y',
				instrument: true
			});
			login.logger.pushLogs();
		}

		function hidePassword(e) {
			if (baseType === 'tel') {
				$(field).addClass('tel-password');
			} else {
				field.setAttribute('type', 'password');
			}
			$(btnShow).removeClass('hide');
			$(btnHide).addClass('hide');
			field.focus();
			e.stopPropagation();

			login.logger.log({
				evt: 'is_pwd_sh',
				data: 'N',
				instrument: true
			});
			login.logger.pushLogs();
		}

		function displayShowHideButtons(e) {
			undisplayShowHideButtons();
			if ((login.utils.isFieldPrefilled(field) || field && field.value && field.value.length > 0)) {
				if (baseType === 'text') {
					// email/password
					if (field.getAttribute('type') === 'password') {
						$(btnShow).removeClass('hide');
					} else {
						$(btnHide).removeClass('hide');
					}
				} else {
					// phone/pin
					if ($(field).hasClass('tel-password')) {
						$(btnShow).removeClass('hide');
					} else {
						$(btnHide).removeClass('hide');
					}
				}
			}
			e.stopPropagation();
		}

		// Show the password (change input field type to text) on click of Show
		btnShow.onclick = showPassword;

		// Mask the password (change input field type to password - or add class to mask tel) on click of Hide
		btnHide.onclick = hidePassword;

		// On focus OR keyup of the password/pin field, display Show button if password/pin field has a value
		field.onfocus = displayShowHideButtons

		addEvent(field, 'keyup', displayShowHideButtons)

		// Prevent hiding the `Show` button in case password/pin field was clicked
		field.onclick = function(e) {
			e.stopPropagation();
		};

		// Hide the show/hide buttons in case user clicks anywhere
		// The field's onclick event handler will stop propagation to prevent hiding on click of field
		window.onclick = undisplayShowHideButtons;
	}

	return function showHidePassword() {
		var signUpSection = document.querySelector('#signUpSection');
		var passwordSection = document.querySelector('#passwordSection');
		var pinSection = document.querySelector('#pinSection') || document.querySelector('#splitPinSection');
		var pinField;
		if (pinSection) {
			pinField = pinSection.querySelector('.pin-password');
		}

		if (signUpSection) {
			initShowHide(signUpSection);
		}

		if (passwordSection) {
			initShowHide(passwordSection);
		}

		// The `type` attribute of the PIN input field will be set to 'tel' only for webkit browsers
		// In case it's not webkit (e.g. IE on Windows Phone) the PIN field
		// will have type=password. In this case we need to set 'base' type to 'text'
		// Base type is the type to use in case user clicks 'show password' in non-webkit browser
		if (pinSection && pinField) {
			initShowHide(pinSection, pinField.getAttribute('type') === 'tel' ? 'tel' : 'text');
		}
	}
}());

// ONE TOUCH
login.oneTouch = (function() {
	return function oneTouch() {
		var kmliBtn = document.querySelector('.keepMeLoginAbout');
		var kmliContent = document.getElementById('keepMeLoginTerms');
		var tagLine = document.querySelector('.keepMeLogin .tagLine');
		var kmliCb = login.utils.getKmliCb();
		var scTrackKmliOpen = 'scTrack:unifiedlogin-rememberme-about-open';
		var scTrackKmliClose = 'scTrack:unifiedlogin-rememberme-about-close';
		var scTrackKmliOptIn = 'scTrack:unifiedlogin-rememberme-opt-in';
		var scTrackKmliOptOut = 'scTrack:unifiedlogin-rememberme-opt-out';

		if (!kmliCb || !kmliBtn || !kmliContent) {
			return;
		}

		// Remove target specific href to prevent from page scrolling to content
		kmliBtn.setAttribute('href', '#');

		// Slide up/down KMLI content & toggle sc tracking classes on click of KMLI info button
		kmliBtn.onclick = function() {
			if ($(kmliContent).hasClass('slideUp')) {
				// slideUp/slideDown defines the 'state' of the content box (up means closed, down means open)
				$(kmliContent).removeClass('slideUp');
				$(kmliContent).addClass('slideDown');
				$(kmliBtn).attr('aria-expanded', 'true');
				// SC tracking open/close implies call to action
				// Toggle the class with a short delay to prevent the tracking call from picking the change
				// instead of the pre-toggle value
				setTimeout(function() {
					$(kmliBtn).removeClass(scTrackKmliOpen);
					$(kmliBtn).addClass(scTrackKmliClose);
				}, 10);
			} else {
				// slideUp/slideDown defines the 'state' of the content box (up means closed, down means open)
				$(kmliContent).removeClass('slideDown');
				$(kmliContent).addClass('slideUp');
				$(kmliBtn).attr('aria-expanded', 'false');
				// SC tracking open/close implies call to action
				// Toggle the class with a short delay to prevent the tracking call from picking the change
				// instead of the pre-toggle value
				setTimeout(function() {
					$(kmliBtn).removeClass(scTrackKmliClose);
					$(kmliBtn).addClass(scTrackKmliOpen);
				}, 10);
			}

			// User should be able to open/close KMLI content on hitting Enter repeatedly
			kmliBtn.focus();

			// Show hide the tagline on slide up/down event
			if (tagLine) {
				$(tagLine).toggle();
			}

			// Trigger a window resize to displace the footer on open/close KMLI content
			setTimeout(function() {
				window.dispatchEvent && window.dispatchEvent(createNewEvent('resize'));
			}, 200);
		};

		// Toggle sc tracking classes on click of One Touch checkbox
		kmliCb.onclick = function() {
			// Toggle the class with a short delay to prevent the tracking call from picking the change
			// instead of the pre-toggle value
			setTimeout(function() {
				if ($(kmliCb).hasClass(scTrackKmliOptIn)) {
					$(kmliCb).removeClass(scTrackKmliOptIn);
					$(kmliCb).addClass(scTrackKmliOptOut);
				} else {
					$(kmliCb).removeClass(scTrackKmliOptOut);
					$(kmliCb).addClass(scTrackKmliOptIn);
				}
			}, 10);
		}
	}
}());

// Footer
login.footer = (function() {
	var localeSelectors = document.querySelectorAll('.localeSelector li a');

	// Instrument each locale link, if clicked
	for (var i = 0; i < localeSelectors.length; i++) {
		localeSelectors[i].onclick = login.utils.getOutboundLinksHandler(localeSelectors[i], null, 'process_language_change');
	}

	function displaceFooter() {
		var footer = document.querySelector('.footer');
		var content = document.querySelector('.activeContent');
		var returnToMerchant = document.querySelector('#returnToMerchant');
		var totalContentHeight, windowHeight;
		var returnToMerchantHeight = returnToMerchant && $(returnToMerchant).outerHeight() || 0;
		totalContentHeight = $(content).outerHeight() + $(footer).outerHeight() + returnToMerchantHeight;
		// Calculate window height for web browsers and apps that load us in webviews & view controllers
		windowHeight = window.innerHeight ||
			(document.documentElement && document.documentElement.clientHeight) ||
			// screen is available directly but double checking for webviews
			(window.screen && window.screen.height) ||
			document.height || (document.body && document.body.offsetHeight);

		if (windowHeight < totalContentHeight) {
			$(footer).addClass('footerStayPut');
		} else {
			$(footer).removeClass('footerStayPut');
		}
	}

	return function footer() {
		displaceFooter();
		addEvent(window, 'resize', displaceFooter);
	}
}());

// PASSWORD RECOVERY
login.pwr = (function() {
	return function pwr() {
		var forgotPasswordModal = document.querySelectorAll('.startPwrFlowBtn');
		var pwrContainer = document.getElementById('password-recovery-modal');
		var pwdIframe = document.getElementById('pwdIframe');
		var modalCloseBtn, modalUnderlay;

		// If UL is loaded in a iFrame and only when PWR iframe dom element present
		// then let PWR flow start in a new tab instead of modal
		if (pwdIframe && login.utils.isInIframe()) {
			pwdIframe.setAttribute('target', '_blank');
		}

		function showModal(e) {
			e.preventDefault();

			// Create a translucent background
			modalUnderlay = document.createElement('div');
			modalUnderlay.className = 'modal-underlay';
			document.body.appendChild(modalUnderlay);

			// Show PWR div
			pwrContainer.style.display = 'block';

			// Enable CSS animation via the next tick (setting display to block will not permit this right away)
			setTimeout(function() {
				modalUnderlay.style.opacity = 0.7;
				pwrContainer.style.opacity = 1;
			}, 0);

			// Load PWR flow in the designated iframe
			pwdIframe.setAttribute('src', $(pwdIframe).data('src'));

			pwdIframe.focus(); // Remove focus off PWR button to prevent user from hitting Enter & re-open the modal
			pwdIframe.onload = function() {
				repositionModal();
				pwdIframe.focus();
			}

			login.logger.log({
				evt: 'state_name',
				data: login.logger.getStateName(),
				instrument: true
			});

			login.logger.log({
				evt: 'transition_name',
				data: 'process_password_recovery',
				instrument: true
			});

			login.logger.pushLogs();
		}

		/**
		 * Hide modal for Password Recovery flow & remove the modal underlay
		 */
		function hideModal() {
			var modalUnderlay = document.querySelector('.modal-underlay');
			document.body.removeChild(modalUnderlay);
			pwrContainer.style.display = 'none';
			pwdIframe.setAttribute('src', 'about:blank');
			pwdIframe.setAttribute('title', 'pwdIframe');
			// Focus the 'Try Another Optjon' link by default as More Options' PWR flow link will already be hidden
			if (forgotPasswordModal && forgotPasswordModal.length > 0) {
				forgotPasswordModal[1].focus();
			}
		}

		/**
		 * The modal needs to be repositioned in case of a small 'available window height'
		 * This function is called once on load of the PWR iframe and on every browser window resize
		 */
		function repositionModal() {
			var windowHeight = window.innerHeight || document.documentElement.clientHeight;
			if (windowHeight <= pwrContainer.clientHeight) {
				pwrContainer.style.transform = 'translate(-50%, 0%)';
				pwrContainer.style.top = 0;
			} else {
				pwrContainer.style.transform = 'translate(-50%, -50%)';
				pwrContainer.style.top = '50%';
			}
		}

		// Load PWR in a modal only if 'forgot password' button exists AND UL is NOT in a iframe
		if (pwrContainer && forgotPasswordModal && forgotPasswordModal.length > 0 && !login.utils.isInIframe()) {
			// Add a close button to the modal
			modalCloseBtn = document.createElement('button');
			modalCloseBtn.className = 'ui-dialog-titlebar-close';
			modalCloseBtn.setAttribute('type', 'button');
			modalCloseBtn.setAttribute('alt', 'Close');
			pwrContainer.appendChild(modalCloseBtn);

			// Attach events to show/hide modal
			for (var i = 0; i < forgotPasswordModal.length; i++) {
				addEvent(forgotPasswordModal[i], 'click', showModal);
			}
			modalCloseBtn.onclick = hideModal;

			// If the modal is open, allow the user to only tab around within the context of the modal
			// including the modal close btn.
			// To start with, explicitly set focus to the modal close btn in case the user is going out
			// of the PWR iframe
			addEvent(pwdIframe, 'focusout', function(e) {
				e.preventDefault();
				modalCloseBtn.focus();
			});

			// Explicitly set focus to the iframe in case tabbing from the close button
			// Set the `isTabbedInFromModalCloseBtn` to true so that we dont get stuck at this point in the rotation
			modalCloseBtn.onkeydown = function(e) {
				if (e.which === 9) {
					pwdIframe.focus();
				}
			}

			addEvent(window, 'resize', repositionModal);
		}
	}
}());

login.authCaptcha = (function() {
	return function authCaptcha(isAutoSubmit) {
		var captchaRefresh = document.querySelector('.captchaRefresh');
		var captchaPlay = document.querySelector('.captchaPlay');
		var captcha = document.querySelector('#captcha');
		var captchaForm = document.querySelector('#ads-container form');
		var captchaDom = getCaptchaDom(captcha);
		var validateOnKeyUp = false;

		if (isAutoSubmit) {
			submitCaptchaForm();
			return;
		}

		function refreshCaptcha(event) {
			event.preventDefault();
			event.stopPropagation();
			$.ajax({
				method: 'GET',
				url: '/auth/refreshcaptcha',
				success: function(response) {
					if (response !== 'undefined') {
						// populate captcha image and audio sources
						$('.captcha-container img').attr('src', response.captchaImgUrl);
						$('.captcha-container .audio a').attr('href', response.captchaAudioUrl);
						$('.captcha-container input').val('');// reset captcha input text
						// Reset audio tag
						$('#captchaPlayer').attr('src', response.captchaAudioUrl);

						// Set focus on captcha input field only in desktop browser
						if ($('body').hasClass('desktop')) {
							$('.captcha-container input').focus();
						}
					}
				}
			});
		}

		function playCaptcha(event) {
			var audioTag = document.getElementById('captchaPlayer'),
				audioSupport = !!(audioTag.canPlayType && audioTag.canPlayType('audio/mpeg;').replace(/no/, ''));

			if (audioSupport) {
				event.preventDefault();
				// Set the focust to captcha field priour to play the audio.
				$('.captcha-container input').focus();
				audioTag.play();
			} else {
				// Open in new tab or page based on browser
				return true;
			}
		}

		function showError(dom) {
			$(dom.container).addClass('hasError');
			dom.container.style['z-index'] = 100;
			$(dom.errMsgContainer).addClass('show');
			dom.field.focus();
		}

		function showRequiredError(dom) {
			$(dom.errMsg).removeClass('hide');
		}

		function hideRequiredError(dom) {
			$(dom.errMsg).addClass('hide');
		}

		function validateFieldHasValue(dom) {
			if (dom.field && typeof dom.field.value === 'string' && !dom.field.value.trim()) {
				showError(dom); // Draw a red border around the field with an exclaimation icon
				showRequiredError(dom); // Slide down field level error notification
				return false;
			}
			return true;
		}

		function validateRequiredFields(captchaDom) {
			var captchaOk = true;

			if (captchaDom && captchaDom.field && !isAutoSubmit) { // Captcha was shown
				captchaOk = validateFieldHasValue(captchaDom);
			}

			return captchaOk;
		}

		function getCaptchaDom(wrapperElement) {
			if (!wrapperElement) {
				return null;
			}

			return {
				container: wrapperElement.querySelector('div.textInput'),
				field: wrapperElement.querySelector('input[type=text]'),
				errMsgContainer: wrapperElement.querySelector('div.errorMessage'),
				errMsg: wrapperElement.querySelector('div.errorMessage .emptyError')
			}
		}

		function submitCaptchaForm(event) {
			var isValidInput = validateRequiredFields(captchaDom);
			var formFields = document.querySelector('form[name=challenge]');
			var formData = {};
			validateOnKeyUp = true;

			if (event) {
				eventPreventDefault(event);
			}

			if (!isValidInput) {
				return;
			}

			login.utils.showSpinner();
			for (var i = 0; i < formFields.length; i++) {
				formData[formFields[i].name] = formFields[i].value;
			}

			$.ajax({
				url: captchaForm.getAttribute('action'),
				data: formData,
				success: login.utils.successfulXhrHandler,
				fail: login.utils.failedXhrSubmitHandler
			})
		}

		function onFieldFocusHandler(dom) {
			if ($(dom.container).hasClass('hasError')) {
				validateOnKeyUp = true;
			} else {
				validateOnKeyUp = false;
			}
		}

		function hideError(dom, removeErrHighlight) {
			if (removeErrHighlight) {
				$(dom.container).removeClass('hasError');
			}
			dom.container.style['z-index'] = 1;
			$(dom.errMsgContainer).removeClass('show');
		}

		function onFieldBlurHandler(dom) {
			validateOnKeyUp = false;
			hideError(dom);
		}

		function onFieldKeyUpHandler(dom) {
			var trimmedValue = dom.field.value.trim();
			if (!validateOnKeyUp) {
				return false;
			}

			if (trimmedValue === '') {
				showRequiredError(dom);
			} else {
				hideRequiredError(dom);
				hideError(dom, true);
			}
		}

		captchaRefresh.onclick = refreshCaptcha;
		captchaPlay.onclick = playCaptcha;
		captchaForm.onsubmit = submitCaptchaForm;
		captchaDom.field.onfocus = onFieldFocusHandler.bind(null, captchaDom);
		captchaDom.field.onblur = onFieldBlurHandler.bind(null, captchaDom);
		captchaDom.field.onkeyup = onFieldKeyUpHandler.bind(null, captchaDom);
	}
}());

// ADS
login.ads = (function() {
	function init(challengeUrl) {
		var adsScriptTag;
		var adsChallengeUrl = challengeUrl || $('body').data('adsChallengeUrl');

		$.ajax({
			url: adsChallengeUrl,
			method: 'GET',
			success: function(res) {
				adsScriptTag = document.createElement('script');
				adsScriptTag.id = 'ads';
				adsScriptTag.type = 'text/javascript';
				adsScriptTag.setAttribute('nonce', $('body').data('nonce'));
				// Remove html|body|script tags that ADS adds before responding
				adsScriptTag.text = res.replace(/<\/?(html|body|script)>/g, '');
				document.body.appendChild(adsScriptTag);
			},
			fail: function(status) {
				// ADS call failed with a non 200 status
			}
		});
	}

	/**
	 * If ngRL intercepts this request and needs to issue a captcha, they will redirect the request to AC/ADS
	 * ADS will then send back a HTML response which will the JavaScript that they need to execute in the browser.
	 * We will inject this HTML in a DIV of our own and execute the JavaScript contained therein.
	 */
	function handleAdsInterception(htmlResponse) {
		var isAutoSubmit = true;
		var adsContainerId = 'ads-container';
		var adsContainerDiv, scriptNodes, adsCaptchaType;

		// Remove any existing captcha
		if (document.getElementById('ads-container')) {
			document.getElementById('ads-container').parentNode.removeChild(document.getElementById('ads-container'));
		}

		adsContainerDiv = document.createElement('div');
		adsContainerDiv.setAttribute('id', adsContainerId);
		adsContainerDiv.innerHTML = htmlResponse;

		// Insert fresh captcha
		$('#main').append(adsContainerDiv);

		// Execute any JavaScript from the HTML without being evil
		scriptNodes = adsContainerDiv.getElementsByTagName('script');
		for (var i = 0; i < scriptNodes.length; i++) {
			eval.call(this, scriptNodes[i].innerHTML);
		}

		if (typeof autosubmit !== 'undefined') {
			isAutoSubmit = autosubmit;
		}

		if (typeof captchatype !== 'undefined') {
			adsCaptchaType = captchatype;
		}

		// Hide the captcha if autosubmit is true
		if (isAutoSubmit) {
			document.getElementById('ads-container').style.display = 'none';
		} else {
			// Hide the login form in case auto submit is false
			$('#login').addClass('hide');
		}

		if (typeof login.authCaptcha === 'function') {
			login.authCaptcha(isAutoSubmit);
		}

		if (!isAutoSubmit) {
			// Hide spinner as captcha form will be shown
			login.utils.hideSpinner();
			login.utils.hideSpinnerMessage();
		}

		login.logger.log({
			evt: 'ads_state_name',
			data: isAutoSubmit ? 'pre_jschallenge_served' : adsCaptchaType,
			instrument: true
		});
		login.logger.pushLogs();
	}

	return {
		init: init,
		handleAdsInterception: handleAdsInterception
	};
}());

login.tpdLogin = (function() {
	var utils = login.utils;
	var loginForm = document.querySelector('form[name=login]');

	function logMetrics(data) {
		var logOptions = {};
		if (!data) {
			// early return
			return;
		}
		login.logger.log({
			evt: 'state_name',
			data: data.stateName,
			instrument: true
		});
		login.logger.log({
			evt: 'transition_name',
			data: data.transitionName,
			instrument: true
		});
		if (data.calName) {
			login.logger.log({
				evt: 'TPD_CLIENT',
				data: data.calName,
				calEvent: true
			});
		}
		login.logger.pushLogs();
	}

	function instrumentVerificationViewRendered() {
		logMetrics({
			stateName: 'begin_tpd',
			transitionName: 'prepare_verification'
		});
	}

	function instrumentTpdLoginClicked(param) {
		logMetrics({
			stateName: 'begin_pwd',
			transitionName: 'process_pwd_tpd_click',
			calName: 'INIT_TPD' + (param && ('_' + param))
		});
	}

	function instrumentTpdLoginAutoTriggered() {
		logMetrics({
			stateName: 'begin_tpd',
			transitionName: 'process_pwd_tpd_auto',
			calName: 'AUTO_TPD_LOGIN'
		});
	}

	function instrumentNotYouClicked() {
		logMetrics({
			stateName: 'begin_tpd',
			transitionName: 'process_not_you',
			calName: 'PROCESS_NOT_YOU'
		});
	}

	function instrumentResendClicked() {
		logMetrics({
			stateName: 'begin_tpd',
			transitionName: 'process_resend',
			calName: 'PROCESS_RESEND'
		});
	}

	function instrumentUsePasswordInstead(reason) {
		switch (reason) {
			case 'passwordReason1':
				logMetrics({
					stateName: 'begin_use_pwd',
					transitionName: 'process_no_phone',
					calName: 'USE_PASSWORD_NO_PHONE'
				});
				break;
			case 'passwordReason2':
				logMetrics({
					stateName: 'begin_use_pwd',
					transitionName: 'process_no_notification',
					calName: 'USE_PASSWORD_NO_NOTIFICATION'
				});
				break;
			case 'passwordReason3':
				logMetrics({
					stateName: 'begin_use_pwd',
					transitionName: 'process_prefer_password',
					calName: 'USE_PASSWORD_PREFER_PASSWORD'
				});
				break;
			case 'passwordReason4':
				logMetrics({
					stateName: 'begin_use_pwd',
					transitionName: 'process_try_later',
					calName: 'USE_PASSWORD_TRY_LATER'
				});
				break;
			case 'passwordReason5':
				logMetrics({
					stateName: 'begin_use_pwd',
					transitionName: 'process_other',
					calName: 'USE_PASSWORD_OTHER'
				});
				break;
			default:
				logMetrics({
					stateName: 'begin_tpd',
					transitionName: 'process_use_pwd',
					calName: 'USE_PASSWORD'
				});
		}

	}

	function instrumentTpdExpired(reason) {
		logMetrics({
			stateName: 'end_tpd_notification',
			transitionName: 'expired_tpd_no_action',
			calName: 'EXPIRED_TPD_' + reason
		});
	}
	function attemptTpdLogin(currentVariant) {
		var formFields = document.querySelectorAll('form[name=login] input');
		var formData = {};
		var variant = $('body').data('tpdVariant');
		if ($('body').data('isPrefillEmailEnabled') && $('body').data('tpdDemo')) {
			document.body.removeAttribute('data-is-prefill-email-enabled');
		}
		utils.showSpinner();

		// Make XHR login call with email only
		// and splitLoginContext = 'tpd'
		// Collect form fields in an object
		for (var i = 0; i < formFields.length; i++) {
			formData[formFields[i].name] = formFields[i].value;
		}

		if (formData.tpdEligible !== 'true') {
			// Cancel everything
			utils.hideSpinner();
			return;
		}
		formData.splitLoginContext = 'tpd';
		// Do not send the password field in the request
		// Since this on click of Next which will only collect public credential of the user
		delete formData.login_password;
		delete formData.login_pin;

		// add tpd current variant tried by the user to collect data
		// eg: it can be autoSend or it can be user initiated variant when user clicks button
		formData.tpdVariant = currentVariant;
		formData.originalVariant = variant;

		// Fraudnet data
		login.fn.addFnSyncData();

		$.ajax({
			url: loginForm.getAttribute('action'),
			method: 'POST',
			data: formData,
			success: utils.successfulXhrHandler,
			fail: utils.failedXhrSubmitHandler
		});
	}

	function initialize() {
		var isAutoSend = $('body').data('tpdAutoSend');
		if (login.utils.isTpdDemo()) {
			return;
		}
		if (isAutoSend === 'true') {
			instrumentTpdLoginAutoTriggered();
			attemptTpdLogin('autoSend');
		}
	}

	return {
		instrumentVerificationViewRendered: instrumentVerificationViewRendered,
		instrumentTpdLoginClicked: instrumentTpdLoginClicked,
		instrumentTpdLoginAutoTriggered: instrumentTpdLoginAutoTriggered,
		instrumentNotYouClicked: instrumentNotYouClicked,
		instrumentResendClicked: instrumentResendClicked,
		instrumentUsePasswordInstead: instrumentUsePasswordInstead,
		initialize: initialize,
		attemptTpdLogin: attemptTpdLogin,
		instrumentTpdExpired: instrumentTpdExpired
	}
}());

// sso login support
login.singleSignOn = (function() {
	var utils = login.utils;
	var transitioningDiv = document.querySelector('.transitioning');
	var tenantSSO = $('body').data('tenantsso');
	var isInboundSso = $('body').data('isInboundSso');
	var tenantSSOContingency = $('body').data('tenantssocontingency');
	var ssoInterstitial = $('body').data('ssoInterstitial');

	function getSsoLoginType() {
		if (isInboundSso) {
			return 'inbound_sso_login';
		}
		return 'sso_login';
	}
	function logCPLData(data) {
		data = data || {};
		logger.log({evt: 'state_name', data: 'CPL_LATENCY_METRICS', instrument: true});
		logger.log({evt: 'login_experience', data: 'SSO', instrument: true});
		var tt = JSON.stringify({
			'start': data.ssoTimeStart,
			'tt': Date.now() - data.ssoTimeStart
		});
		logger.log({evt: 'login_auth_time',
			data: tt,
			instrument: true});
		logger.log({evt: 'status', data: data.status, instrument: true});
		logger.pushLogs();
	}
	function doSsoLogin() {
		var data = {};
		var ssoDefaultContent = $('body').data('ssoDefaultContent');
		var loginFormInputList = document.querySelectorAll('form[name=login] input[type=hidden]');
		var ssoLoginType = getSsoLoginType();
		var timeoutEnable = false;
		// Start to show the progress message with spinner
		if (tenantSSO && tenantSSO === 'venmo') {
			utils.hideSpinner();
		} else if (isInboundSso) {
			utils.showSpinner();
			if (transitioningDiv) {
				$(transitioningDiv).addClass('nonTransparentMask');
			}
		} else {
			utils.showSpinner();
			if (transitioningDiv) {
				$(transitioningDiv).addClass('nonTransparentMask');
			}
			(ssoDefaultContent) ? utils.showSpinnerMessage('oneSecond') : utils.showSpinnerMessage('secureMessage');
		}
		data.ssoViaToken = true;
		data.isInboundSso = isInboundSso;
		login.fn.updateFnSyncContext({sourceId: 'SSO_LOGIN'});
		login.fn.addFnSyncData();

		var formInputs = {_csrf: 1, intent: 1, ctxId: 1, returnUri: 1, state: 1, authContextId: 1, authCode: 1, billingId: 1,
			'locale.x': 1, fn_sync_data: 1, flowId: 1, assertion: 1};

		// Iterate all the hidden form input field list
		for (var i = 0; i < loginFormInputList.length; i++) {
			if (formInputs[loginFormInputList[i].name]) {
				data[loginFormInputList[i].name] = loginFormInputList[i].value;
			}
		}

		login.logger.log({
			evt: 'state_name',
			data: ssoLoginType,
			instrument: true
		});

		login.logger.log({
			evt: 'transition_name',
			data: 'prepare_' + ssoLoginType,
			instrument: true
		});

		login.logger.pushLogs();

		if ($('body').data('xhrTimeoutEnable') && utils.isSpinnerShown() && !utils.isUserAgentIneligibleForTimeout()) {
			timeoutEnable = true;
		}
		var ssoTimeStart = $('body').data('loadStartTime');
		$.ajax({
			url: '/signin/sso',
			method: 'POST',
			data: data,
			timeoutEnable: timeoutEnable,
			success: function(res) {
				var returnUrl = res.returnUrl;
				var failureReturnUrl = res.failureReturnUrl;
				login.utils.logCPLData({startTime: ssoTimeStart, status:'success', flowName: 'SSO'});
				login.logger.log({
					evt: 'state_name',
					data: ssoLoginType,
					instrument: true
				});

				login.logger.log({
					evt: 'transition_name',
					data: 'process_' + ssoLoginType,
					instrument: true
				});

				login.logger.pushLogs();
				// Do redirect to returnUrl on success
				if (tenantSSO && (returnUrl || failureReturnUrl)) {
					utils.isBrowserInPrivateMode(function(result) {
						var isPrivate = result && result.isPrivate;
						if (!isPrivate && returnUrl) {
							window.location.href = returnUrl;
							return;
						}

						if (isPrivate) {
							window.location.href = failureReturnUrl || returnUrl;
						}
					});

					return;
				} else if (isInboundSso && (returnUrl || failureReturnUrl)) {
					window.location.href = failureReturnUrl || returnUrl;
					return;
				} else if (returnUrl) {
					window.location.href = returnUrl;
					return;
				}
				if (res.notifications) {
					var notifications = document.querySelector('.notifications');
					notifications.innerHTML = '';
					login.utils.updatePageLevelError(res.notifications.msg, res.notifications.type);
				}
				// In case if there is not returnUrl then show login page
				// It is not expected to happen in any case
				if (ssoInterstitial) {
					location.reload();
					return;
				}
				if (tenantSSO !== 'venmo') {
					utils.hideSpinner();
					utils.hideSpinnerMessage('oneSecond');
					utils.hideSpinnerMessage('secureMessage');
				}
			},
			fail: function(status) {
				// Show login page
				login.utils.logCPLData({startTime: ssoTimeStart, status:'failure', flowName: 'SSO'});
				var res = utils.parseJsonSafe(status.response);
				if ((tenantSSO && tenantSSO === 'venmo' ||
					tenantSSOContingency && tenantSSOContingency === 'venmo') && res.returnUrl) {
					window.location.href = res.returnUrl;
					return;
				}

				if (ssoInterstitial) {
					location.reload();
					return;
				}
				utils.hideSpinner();
				utils.hideSpinnerMessage('oneSecond');
				utils.hideSpinnerMessage('secureMessage');
			}
		});
	}

	return function ssoLogin() {
		var ssoViaToken = $('body').data('ssoviatoken');
		if (ssoViaToken) {
			login.fn.initialize();
			doSsoLogin();
			return;
		}
	}
}());

// User device token login
login.userDeviceTokenLogin = (function() {
	var utils = login.utils;
	var logger = login.logger;
	var ulData = window.PAYPAL.ulData || {};
	var calEventType = 'UDT';
	var intent = utils.getIntent();

	function logUserDeviceTokenLoginStart() {
		var clientLogList = [];
		var currentLang = document.querySelector('input[name="locale.x"]');

		clientLogList.push({evt: 'state_name', data: 'Login_UL_UDT', instrument: true});
		clientLogList.push({evt: 'transition_name', data: 'prepare_login_UL_UDT', instrument: true});
		clientLogList.push({evt: 'design',
			data: utils.isInContextIntegration() ? 'in-context' : 'full-context', instrument: true});
		if (currentLang) {
			clientLogList.push({evt: 'page_lang', data: currentLang.value, instrument: true});
		}
		clientLogList.push({evt: calEventType, data: 'PREPARE_PAGE_' + intent.toUpperCase(), calEvent: true});
		logger.clientLog(clientLogList, null);
	}

	function logUserDeviceTokenLoginFailed(errorCode) {
		var splitLoginContext = utils.getSplitLoginContext();

		// Log the exit error code when displaying login for failure case
		logger.log({
			evt: 'ext_error_code',
			data: errorCode,
			instrument: true
		});

		// Invoke the default page load client logger method
		if (splitLoginContext) {
			instrumentSplitLoginPageLoad(splitLoginContext);
			return;
		}
		// Fallback logging
		instrumentUlAsLandingPageLoad();
	}

	function doUserDeviceTokenLogin(next) {
		// Get all of the hidden login form input element (except any of public credential field)
		var loginFormInputList = document.querySelectorAll('form[name=login] input[type=hidden]');
		var loginEmail = document.querySelector('input[name=login_email]');
		var loginPassword = document.querySelector('input[name=login_password]');
		var timeoutEnable = false;

		// List of form fields expected to send for implicit login
		var requiredFormInputs = {_csrf: 1, intent: 1, flowId: 1, ctxId: 1, returnUri: 1, state: 1, 'locale.x': 1, fn_sync_data: 1};

		var data = {};
		// Iterate all the hidden form input field list
		// NOTE - loginFormInputList is a NodeList, not Array
		// https://developer.mozilla.org/en-US/docs/Web/API/NodeList
		for (var i = 0; i < loginFormInputList.length; i++) {
			var item = loginFormInputList[i];
			if (requiredFormInputs[item.name]) {
				data[item.name] = item.value
			}
		}

		// Start to show the progress message with spinner
		var udtSpinnerMessage = $('body').data('udtSpinnerMessage');
		var transitioningWelcomeName = $('body').data('transitioningWelcomeName');
		utils.showSpinner({ nonTransparentMask: true });
		if (transitioningWelcomeName) {
			utils.showSpinnerMessage('welcomeMessage');
		}
		utils.showSpinnerMessage(udtSpinnerMessage);
		var webLLSStartTime = $('body').data('loadStartTime');
		// Log FPTI
		logUserDeviceTokenLoginStart();

		if ($('body').data('xhrTimeoutEnable') && utils.isSpinnerShown() && !utils.isUserAgentIneligibleForTimeout()) {
			timeoutEnable = true;
		}
		$.ajax({
			url: '/signin/ud-token',
			method: 'POST',
			data: data,
			timeoutEnable: timeoutEnable,
			success: function(res) {
				utils.logCPLData({startTime: webLLSStartTime, status:'success', flowName:'Web LLS'});
				if (loginEmail) {
					loginEmail.removeAttribute('disabled');
				}

				if (loginPassword) {
					loginPassword.removeAttribute('disabled');
				}

				// Do redirect to returnUrl on success
				if (res.returnUrl) {
					window.location.href = res.returnUrl;
					return;
				}

				// If there's any failure, just hide the spinner (login as normal)
				utils.hideSpinnerMessage(udtSpinnerMessage);
				if (transitioningWelcomeName) {
					utils.hideSpinnerMessage('welcomeMessage');
				}
				utils.hideSpinner();

				// Remove user device token login related context from the client
				document.querySelector('body').removeAttribute('data-user-device-token-login');

				logUserDeviceTokenLoginFailed('udt_login_failed');

				return next();
			},
			fail: function() {
				utils.logCPLData({startTime: webLLSStartTime, status:'failure', flowName:'Web LLS'});
				// If there's any failure, just hide the spinner (login as normal)
				if (loginEmail) {
					loginEmail.removeAttribute('disabled');
				}

				if (loginPassword) {
					loginPassword.removeAttribute('disabled');
				}

				utils.hideSpinnerMessage(udtSpinnerMessage);
				if (transitioningWelcomeName) {
					utils.hideSpinnerMessage('welcomeMessage');
				}
				utils.hideSpinner();

				// Remove user device token login related context from the client
				document.querySelector('body').removeAttribute('data-user-device-token-login');

				logUserDeviceTokenLoginFailed('udt_login_xhr_failed');

				return next();
			}
		})
	}

	return function userDeviceTokenLogin(next) {
		var userDeviceTokenLogin = $('body').data('userDeviceTokenLogin');

		// Add fn sync data for webLLS
		logger.log({
			evt: 'FN_PAYLOAD',
			data: 'send_fn_sync_data_on_web_LLS',
			instrument: true
		});
		logger.pushLogs();
		login.fn.addFnSyncData();

		if (userDeviceTokenLogin) {
			return doUserDeviceTokenLogin(next);
		}
		return next();
	}
}());

login.ssoInterstitial = (function() {
	function handleContinue() {
		var body = $('body');
		if (body) {
			body.data('ssoviatoken', 'true');
		}
		if (login.singleSignOn) {
			login.singleSignOn();
		}
	}

	function attachFormEvent() {
		var continueInterstitial = document.getElementById('continueInterstitial');
		addEvent(continueInterstitial, 'click', handleContinue);
	}
	return {
		attachFormEvent: attachFormEvent
	};
}());

login.smartLock = (function() {
	var slData;
	var body = document.body;
	var slEventsRegistered = false;
	var transitioningDiv = document.querySelector('.transitioning');
	var sllanding = document.querySelector('#slLanding');
	var slContent = sllanding && sllanding.querySelector('#slContent');
	var loginSection = document.querySelector('#login');
	var loginContent = loginSection && loginSection.querySelector('#content');
	var deviceType = $(body).hasClass('mobile') ? 'MOBILE' : 'DESKTOP';
	var slAuthFrame = document.querySelector('#slAuthFrame');
	var slFrame = document.querySelector('#slFrame');
	var localeSelector = sllanding && sllanding.querySelector('.localeSelector');
	var loginForm = document.querySelector('form[name=login]');
	var slActionTimedOut = false;
	var startTime;
	var timeoutFunction;
	var idToken;
	var slNonce, validateNonce;
	var showActivation, validateResponseDuration;

	function logMetrics(data) {
		var logOptions = {};
		if (!data) {
			// early return
			return;
		}
		login.logger.log({
			evt: 'state_name',
			data: data.stateName,
			instrument: true
		});
		login.logger.log({
			evt: 'transition_name',
			data: data.transitionName,
			instrument: true
		});
		login.logger.log({
			evt: 'api_name',
			data: data.apiName,
			instrument: true
		});
		if (data.errorCode) {
			login.logger.log({
				evt: 'ext_error_code',
				data: data.errorCode,
				instrument: true
			});
		}
		if (data.calName) {
			login.logger.log({
				evt: 'CROSS_DEVICE_OT_CLIENT',
				data: data.calName + '_' + deviceType,
				calEvent: true
			});
		}
		if (data.respDuration) {
			login.logger.log({
				evt: 'resp_duration',
				data: data.respDuration,
				instrument: true
			});
		}
		if (data.updateCapping) {
			logOptions.data = {
				updateCapping: data.updateCapping
			};
		}
		if (data.resetCapping) {
			logOptions.data = logOptions.data || {};
			logOptions.data.resetCapping = data.resetCapping;
		}
		if (data.googleSessionExists) {
			login.logger.log({
				evt: 'google_session_exists',
				data: data.googleSessionExists,
				instrument: true
			});
		}
		if (data.redirectOnComplete) {
			logOptions.complete = function() {
				// redirect upon user cancel or error getting idToken from Google
				login.utils.showSpinner();
				window.location.href = slData.slReturnUrl || '';
			};
		}
		if (data.slTokenStatus) {
			login.logger.log({
				evt: 'sl_token_status',
				data: data.slTokenStatus,
				instrument: true
			});
		}
		if (data.isOneTap) {
			login.logger.log({
				evt: 'GOOGLE_ONE_TAP',
				data: 'GOOGLE_ONE_TAP_ENABLED',
				calEvent: true
			});
			login.logger.log({
				evt: 'sl_google_api',
				data: 'google_one_tap_enabled',
				instrument: true
			});
		}
		login.logger.pushLogs(logOptions);

	}

	function isMobile() {
		return $(body).hasClass('mobile');
	}
	function getCurrentTime() {
		return Date.now ? Date.now() : (new Date()).getTime();
	}
	// Function to show Learn More modal
	function showModal(modalElement) {
		var modalUnderlay = document.querySelector('.modal-underlay');
		if (isMobile()) {
			modalElement.style.width = '100%';
			modalElement.style.height = '100%';
		}
		// Create a translucent background
		if (!modalUnderlay) {
			modalUnderlay = document.createElement('div');
			modalUnderlay.className = 'modal-underlay';
			document.body.appendChild(modalUnderlay);
		}
		// Show learn more div
		modalElement.style.display = 'block';
		modalUnderlay.style.opacity = 0.7;
		modalElement.style.opacity = 1;
		login.logger.log({
			evt: 'CROSS_DEVICE_OT_CLIENT',
			data: 'LEARN_MORE_' + deviceType,
			calEvent: true
		});
	}
	// Function to hide learn more
	function hideModal(modalElement) {
		var modalUnderlay = document.querySelector('.modal-underlay');
		if (modalUnderlay) {
			document.body.removeChild(modalUnderlay);
		}
		modalElement.style.display = 'none';
	}

	// Function to call notYou handler upon clicking change
	function changeLinkHandler(event) {
		// Reset the iFrame to support subsequent requests
		slAuthFrame = slAuthFrame && $(slAuthFrame).remove();
		if (event && event.target && event.target.id === 'backToInputEmailLink') {
			return;
		}
		login.logger.log({
			evt: 'CROSS_DEVICE_OT_CLIENT',
			data: 'CHANGE_' + deviceType,
			calEvent: true
		});
		login.logger.log({
			evt: 'clicked_not_you',
			data: 'y',
			instrument: true
		});

		// TODO log fpti here
		login.utils.notYouClickHandler(event, function() {
			if (sllanding) {
				$(sllanding).addClass('hide');
				$(sllanding).removeClass('activeContent');
			}
			if (loginSection) {
				$(loginSection).removeClass('hide');
				$(loginSection).addClass('activeContent');
			}
		});
	}
	// Initiate XHR
	function makeServiceRequest(options, successHandler, failureHandler) {
		var oneSecondMsg = document.querySelector('.transitioning p.oneSecond');
		var data = {};
		options = options || {};

		if (options.data) {
			data = options.data;
		}
		// Set the CSRF token
		data['_csrf'] = login.utils.getCSRFToken();

		// Show spinner default to all XHR calls
		login.utils.showSpinner();
		if (oneSecondMsg) {
			$(oneSecondMsg).removeClass('hide');
		}

		$.ajax({
			type: options.method || 'POST',
			url: '/signin/' + options.path,
			data: data,
			dataType: 'json',
			success: function(response) {
				login.utils.setCSRFToken(response && response['_csrf']);
				return successHandler(response);
			},
			fail: failureHandler
		});
	}

	// Switch to login page view from SL view
	function switchFromSLToLogin(error) {
		if (sllanding) {
			$(sllanding).addClass('hide');
			$(sllanding).removeClass('activeContent');
		}
		if (loginSection) {
			$(loginSection).removeClass('hide');
			$(loginContent).addClass('activeContent');
		}
		// Reset the iFrame to support subsequent requests
		slAuthFrame = slAuthFrame && $(slAuthFrame).remove();
		triggerEvent(window, 'resize');
		// Hide any spinner messages we would have set
		login.utils.hideSpinnerMessage('retrieveInfo');
		login.utils.hideSpinnerMessage('waitFewSecs');
		// Spinner end
		login.utils.hideSpinner();
		login.fn.updateFnSyncContext({sourceId: 'UL_CHECKOUT_INPUT_PASSWORD'});
		// Log CAL and FPTI
		logMetrics({
			stateName: 'switch_to_pwd',
			transitionName: 'process_switch_to_pwd',
			calName: 'PWD_FALLBACK_' + login.utils.getIntent(),
			errorCode: error
		});
		return;
	}

	// Function to call server to validate idToken
	function handleAccept(idToken, actionIntent) {
		var ctxId = document.querySelector('input[name=ctxId]');
		makeServiceRequest({
			path: 'smart-lock-handler',
			data: {
				smartLockIdToken: idToken,
				nonce: slNonce || '',
				actionIntent: actionIntent,
				returnUrl: slData.slReturnUrl,
				slSessionExists: slData.slSessionExists,
				scimContextId: slData.scimContextId || '',
				intent: login.utils.getIntent(),
				ctxId: ctxId && ctxId.value,
				flowId: login.utils.getFlowId(),
				isActivate: true
			}
		}, function(response) {
			if (response.returnUrl) {
				window.location.href = response.returnUrl;
				return;
			}
			if (actionIntent === 'optin') {
				// In case of returning OT, redirect the user, there wont be a response.returnUrl in fail cases.
				window.location.href = slData.slReturnUrl;
				return;
			}
			// Will be published when switching to password
			login.logger.log({
				evt: 'CROSS_DEVICE_OT_CLIENT',
				data: 'ACTIVATION_FAILED_LOGIN_FALLBACK_' + deviceType,
				calEvent: true
			});
			switchFromSLToLogin('activation failed - prompt pwd');
			return;
		}, function(response) {
			if (actionIntent === 'optin') {
				window.location.href = slData.slReturnUrl;
				return;
			}
			login.logger.log({
				evt: 'CROSS_DEVICE_OT_CLIENT',
				data: 'ACTIVATION_ERROR_LOGIN_FALLBACK_' + deviceType,
				calEvent: true
			});
			switchFromSLToLogin('activation error');
			return;
		});
	}

	// Handler on click of Activate and Continue button
	// Calls handleAccept which submits the idToken to server.
	function activateSmartlockLogin() {
		login.utils.showSpinner();
		logMetrics({
			stateName: 'begin_sl_activation',
			transitionName: 'process_sl_activation_continue',
			calName: 'ACTIVATE_INITIATED'
		});
		return handleAccept(idToken, 'activation');
	}

	function renderActivationPage() {
		var linkedDiv = sllanding.querySelector('#linked');
		var unlinkedDiv = sllanding.querySelector('#unlinked');
		var optInLearnMoreDesc = document.querySelector('#optInLearnMoreDesc');
		if (slActionTimedOut) {
			return;
		}
		// clear timeout fucntion
		clearTimeout(timeoutFunction);
		if (showActivation) {
			if (validateNonce) {
				slNonce = validateNonce;
			}
			if (loginSection) {
				$(loginSection).addClass('hide');
				$(loginContent).removeClass('activeContent');
			}
			if (sllanding) {
				$(sllanding).removeClass('hide');
				$(slContent).addClass('activeContent');
			}
			if (linkedDiv) {
				$(linkedDiv).removeClass('hide');
			}
			if (optInLearnMoreDesc) {
				$(optInLearnMoreDesc).addClass('hide');
			}
			if (unlinkedDiv) {
				$(unlinkedDiv).addClass('hide');
			}
			if (localeSelector) {
				$(localeSelector).addClass('hide');
			}
			// Spinner stop
			// Hide the spinner messages if any that we set during Auth init
			login.utils.hideSpinnerMessage('retrieveInfo');
			login.utils.hideSpinnerMessage('waitFewSecs');
			login.utils.hideSpinner();
			logMetrics({
				stateName: 'begin_sl_activation',
				transitionName: 'prepare_sl_activation',
				calName: 'ACTIVATION_SHOWN',
				respDuration: validateResponseDuration,
				updateCapping: 'smartlockActivate',
				slTokenStatus: 'not_validated'
			});
		} else {
			// Show login page
			login.logger.log({
				evt: 'CROSS_DEVICE_OT_CLIENT',
				data: 'PARTNER_AUTH_FAILED_' + deviceType,
				calEvent: true
			});
			switchFromSLToLogin('partner token invalid');
		}
	}

	// Process auth response
	function onAuthResponse(data) {
		var displayName = sllanding.querySelector('#displayName');
		var displayEmail = sllanding.querySelector('#partnerEmail');
		var displayEmailDomain = sllanding.querySelector('#partnerEmailDomain');
		var partnerPhoto = sllanding.querySelector('#partnerPhoto');
		var loginEmail = sllanding.querySelector('.loginEmail');
		// Clear and prevent timeout logic from kicking in
		var responseDuration = startTime ? (getCurrentTime() - startTime) : 0;
		var metricData = {
			stateName: 'begin_google_auth',
			transitionName: 'process_google_auth',
			apiName: 'google_auth',
			respDuration: responseDuration
		};
		clearTimeout(timeoutFunction);

		if (!data || data.error || !data.idToken) {
			// Handle auth error scenario
			metricData.errorCode = data && data.error;
			metricData.calName = 'AUTH_FAIL';
			// take the user to login page
			switchFromSLToLogin('auth failed');
			// log error
			// Set blocking activation capping
			metricData.updateCapping = 'smartlockBlockingAuth';
			logMetrics(metricData);
		} else {
			// Handle auth success
			metricData.calName = 'AUTH_SUCCESS';
			// set the loginEmail, as submitted by the user or in cookie
			loginEmail.textContent = slData.slLoginEmail;
			if (displayName) {
				displayName.textContent = data.name;
			}
			var emailSplit = data.email && data.email.indexOf('@');
			if (displayEmail) {
				if (emailSplit > 0) {
					displayEmail.textContent = data.email.slice(0, emailSplit);
					displayEmailDomain.textContent = data.email.slice(emailSplit);
				}
			}
			if (partnerPhoto) {
				partnerPhoto.style.backgroundImage = 'url(' + data.image + ')';
			}
			// Validate the obtained idToken in server
			idToken = data.idToken;
			// Log success
			logMetrics(metricData);
			showActivation = true;
			return renderActivationPage();
		}

	}

	// Process non blocking auth response
	function onNonBlockingAuthResponse(data) {
		var responseDuration = startTime ? (getCurrentTime() - startTime) : 0;
		var metricData = {
			stateName: 'begin_nonblock_google_auth',
			transitionName: 'process_nonblock_google_auth',
			apiName: 'google_auth',
			respDuration: responseDuration
		};

		if (!data || data.error || !data.idToken) {
			metricData.errorCode = data && data.error;
			metricData.calName = 'NB_AUTH_FAIL';
		} else {
			metricData.calName = 'NB_AUTH_SUCCESS';
			// Reset blocking activation capping
			// so next time a blocking activate call can be made
			metricData.resetCapping = 'smartlockBlockingAuth';
		}
		logMetrics(metricData);
	}

	function onOptInResponse(data) {
		var responseDuration = startTime ? (getCurrentTime() - startTime) : 0;
		var errorTransition = (data && (data.error === 'userCanceled' || data.method === 'oneTapCancel')) ? 'process_gsl_cancel' : 'process_gsl_error';
		var errorCAL = (data && (data.error === 'userCanceled' || data.method === 'oneTapCancel')) ? 'LINK_CANCELLED' : 'LINK_ERROR';
		var metricData = {
			stateName: 'begin_gsl',
			respDuration: responseDuration,
			isOneTap: slData.googleOneTapEnable
		};
		clearTimeout(timeoutFunction);

		if (data.idToken) {
			metricData.transitionName = 'process_gsl';
			metricData.calName = 'LINK_INITIATED_' + login.utils.getIntent();
			$(transitioningDiv).addClass('nonTransparentMask');
			login.utils.showSpinner();
			logMetrics(metricData);
			handleAccept(data.idToken, 'optin');
		} else {
			// log error and redirect the user
			metricData.transitionName = errorTransition;
			metricData.errorCode = data && data.error;
			metricData.redirectOnComplete = true;
			metricData.calName = errorCAL;
			logMetrics(metricData);
		}
	}

	function onSessionChkResponse(data) {
		var responseDuration = startTime ? (getCurrentTime() - startTime) : 0;
		var loginForm = document.querySelector('form[name=login]');
		var sessionExists = data && data.sessionExists;
		var metricData = {
			stateName: 'begin_gsl_session_check',
			transitionName: 'process_gsl_session_check',
			apiName: 'smartlock_hintsAvailable',
			googleSessionExists: sessionExists,
			calName: 'GOOGLE_SESSION_' + sessionExists + '_' + login.utils.getIntent(),
			respDuration: responseDuration,
			isOneTap: slData.googleOneTapEnable
		};
		clearTimeout(timeoutFunction);

		if (!data || data.error || sessionExists !== 'true') {
			metricData.errorCode = data && data.error;
			metricData.redirectOnComplete = slData.slOptInOT;
			logMetrics(metricData);
		} else {
			addUpdateHiddenElement('slSessionExists', data.sessionExists, loginForm);
			addUpdateHiddenElement('partnerClientId', slData.partnerClientId, loginForm);
			addUpdateHiddenElement('scimContextId', slData.scimContextId, loginForm);
			logMetrics(metricData);
			// If session Exists and is returning OT case, proceed to hint call
			if (slData.slOptInOT) {
				// returning OT should perform hint call on success
				// replace the method to hint in the iframeSrc
				if (!slData.googleOneTapEnable) {
					slData.slFrameSrc = slData.slFrameSrc && slData.slFrameSrc.replace('hintsAvailable', 'hint');
				}
				// reset this flag indicating its returning OT to false, so we dont loop into doing session check again
				slData.slOptInOT = false;
				doOptIn();
			}
		}
	}

	// Function abstracted to conditionally add/update hidden element value
	function addUpdateHiddenElement(key, val, form) {
		var hiddenElement = document.querySelector('[name=' + key + ']');
		if (!hiddenElement) {
			login.utils.addHiddenElement(key, val, form);
		} else {
			hiddenElement.setAttribute('value', val);
		}
	}

	// Post Message handler - process responses from Google Iframe
	function postMessageHandler(event) {
		var eventData = event && event.data || {};
		var message;
		if (slActionTimedOut) {
			// Do not process messages once there has been a timeout
			// To prevent processing events when we don't expect / wait for them anymore
			return;
		}
		// In case of nested iframes(usecase for smartlock api)
		// We need to acknowledge the ping from google so that google iframe to parent communcation can happen
		if (eventData.type === 'verifyPing' && event.source) {
			event.source.postMessage({
				type: 'verifyAck',
				data: eventData.data
			}, '*');
			return;
		}
		// Parse the message into JSON
		if (event && event.data) {
			try {
				message = JSON.parse(event.data);
			} catch (e) {}
		}
		if (!message) {
			return;
		}
		if ((message.source === 'smartlock' && message.method === 'hintsAvailable') || 
				(message.source === 'oneTap' && (message.method === 'oneTapAvailable' || message.method === 'oneTapNoSession'))) {
			return onSessionChkResponse(message);
		}
		if ((message.source === 'smartlock' && message.method === 'hint') || 
				(message.source === 'oneTap' && (message.method === 'oneTapAccept' || message.method === 'oneTapCancel'))) {
			return onOptInResponse(message);
		}
		if (message.source === 'slAuth' && slData.slAction === 'nonblockingAuth') {
			return onNonBlockingAuthResponse(message);
		}
		// Assume slData.slAction === 'activation'
		if (message.source === 'slAuth') {
			return onAuthResponse(message);
		}
	}

	// Function to process auth timeout
	function onAuthTimeout(errMsg) {
		slActionTimedOut = true;
		// Let the log get published along with switch to login FPTI
		login.logger.log({
			evt: 'CROSS_DEVICE_OT_CLIENT',
			data: 'AUTH_TIMEOUT_' + deviceType,
			calEvent: true
		});
		switchFromSLToLogin(errMsg);
	}

	function onOptInTimeout() {
		slActionTimedOut = true;
		// Log and redirect the user to returnUrl
		logMetrics({
			stateName: 'begin_gsl',
			transitionName: 'process_gsl_no_user_action',
			calName: 'OPTIN_ACTION_TIMEOUT_' + login.utils.getIntent(),
			redirectOnComplete: true
		});
	}

	function onSessionChkTimeout() {
		var errorData = slData.slOptInOT ? 'returning_ot_session_chk_timeout' : 'session_chk_timeout';
		slActionTimedOut = true;
		// if slOptInOT is true, set redirectOnComplete as true so the user is redirected to returnUrl after logging is done.
		logMetrics({
			stateName: 'begin_gsl_session_check',
			transitionName: 'process_gsl_session_check',
			apiName: 'smartlock_hintsAvailable',
			errorCode: errorData,
			calName: 'SESSION_CHK_TIMEOUT_' + login.utils.getIntent(),
			redirectOnComplete: slData.slOptInOT
		});
	}

	// Function to do blocking and non blocking Google auth call
	function performGoogleAuth(authUrl, metrics) {
		var loginHint = slData.slLinkedEmail;
		var partnerClientId = slData.partnerClientId;
		startTime = getCurrentTime();

		// Send auth message to Auth iFrame
		function sendAuthMessage(event) {
			slAuthFrame.contentWindow.postMessage(JSON.stringify({
				source: 'UL',
				email: loginHint,
				clientId: partnerClientId,
				authIntent: 'authorize'
			}), '*');
		}

		// Show the login section so the transparent spinner shows the login page in the background
		// Upon showing activation we hide the login section
		$(loginSection).removeClass('hide');

		// log the prepare auth call data
		logMetrics({
			stateName: metrics.stateName,
			transitionName: metrics.transitionName,
			apiName: 'google_auth'
		});
		if (!slAuthFrame) {
			slAuthFrame = login.utils.createIframe({
				id: 'slAuthFrame',
				src: authUrl,
				frameBorder: '0',
				sandbox: 'allow-same-origin allow-scripts',
				style: 'width:0;height:0'
			});
			addEvent(slAuthFrame, 'load', sendAuthMessage);
		} else {
			slAuthFrame.src = authUrl;
		}
	}

	// Function to do google auth
	function doAuth() {
		var authUrl = slData.slAuthUrl;
		var slAuthChkTimeout = slData.slAuthChkTimeout || '3000';
		startTime = getCurrentTime();

		// Spinner start for auth call
		// Show the login section so the transparent spinner shows the login page in the background
		// Upon showing activation we hide the login section
		login.utils.showSpinner();
		login.utils.showSpinnerMessage('retrieveInfo');
		$(loginSection).removeClass('hide');

		if (login.utils.isSiAppleActivationProcessing()) {
			return switchFromSLToLogin('siapple login processing');
		}

		if (!authUrl) {
			return switchFromSLToLogin('Auth URL not found');
		}
		// Set timer to terminate and fallback to login, if the auth response wasn't received in time
		timeoutFunction = setTimeout(function() {
			onAuthTimeout('Auth Timeout');
		}, slAuthChkTimeout);

		performGoogleAuth(authUrl, {
			stateName: 'begin_google_auth',
			transitionName: 'prepare_google_auth'
		});
	}

	// Function to do non blocking google auth
	function doNonBlockingAuth() {
		var authUrl = slData.slAuthUrl;
		startTime = getCurrentTime();

		// Notice: No Spinner for non blocking auth call
		// Show login page and make call on the background
		switchFromSLToLogin('Perform non blockingAuth');
		if (!authUrl) {
			return;
		}

		performGoogleAuth(authUrl, {
			stateName: 'begin_nonblock_google_auth',
			transitionName: 'prepare_nonblock_google_auth'
		});
	}

	function createSmartlockIframe(addClassInfo) {
		var frameSrc = slData.slFrameSrc;
		var className = slData.googleOneTapEnable ? 'hide' : '';
		if (addClassInfo) {
			className = isMobile() ? 'popupMobile' : 'popupWeb';
		}
		if (!slFrame) {
			slFrame = login.utils.createIframe({
				id: 'slFrame',
				title: 'slFrame',
				src: frameSrc,
				frameBorder: '0',
				className: className,
				sandbox: 'allow-same-origin allow-scripts'
			});
		} else {
			slFrame.src = frameSrc;
		}
	}

	// Function to initiate optIn flow - this may include doing hintsAvailable following hint in case of OT
	// Or just hint in case of non OT
	function doOptIn() {
		var frameSrc = slData.slFrameSrc;
		var cancelUrl = sllanding.querySelector('.cancelUrl');
		var slOptInTimeout = slData.slOptInTimeout || '30000';
		var slFrameHeight;
		var linkedDiv = sllanding.querySelector('#linked');
		var unlinkedDiv = sllanding.querySelector('#unlinked');
		var slLoginLearnMoreDesc = document.querySelector('#slLoginLearnMoreDesc');
		var notNowDiv = sllanding.querySelector('#slOptIn_notNow');
		startTime = getCurrentTime();
		// If returningOT, first do the hintsAvailable, and from onSessionChkResponse, again call doOptIn
		if (slData.slOptInOT) {
			return doSessionChk();
		}

		if (cancelUrl && !slData.slDisplayMerchantLink) {
			$(cancelUrl).addClass('hide');
		}
		$(sllanding).removeClass('hide');
		$(slContent).addClass('activeContent');

		if (loginSection) {
			$(loginSection).addClass('hide');
			$(loginContent).removeClass('activeContent');
		}
		if (linkedDiv) {
			$(linkedDiv).addClass('hide');
		}
		if (unlinkedDiv) {
			$(unlinkedDiv).removeClass('hide');
		}
		if (slLoginLearnMoreDesc) {
			$(slLoginLearnMoreDesc).addClass('hide');
		}
		if (localeSelector) {
			$(localeSelector).addClass('hide');
		}
		// Spinner end
		login.utils.hideSpinner();
		// This logging updates the optIn capping too
		logMetrics({
			stateName: 'begin_gsl',
			transitionName: 'prepare_gsl',
			apiName: 'smartlock_hint',
			updateCapping: 'smartlockOptIn',
			calName: 'OPTIN_SHOWN_' + login.utils.getIntent()
		});
		
		triggerEvent(window, 'resize');
		if (frameSrc) {
			timeoutFunction = setTimeout(function() {
				onOptInTimeout();
			}, slOptInTimeout);
			if (!slData.googleOneTapEnable) {
				createSmartlockIframe(true);
			}
			// Fix for introducing scrolling
			slFrame = document.querySelector('#slFrame');
			if (slFrame) {
				if (slData.googleOneTapEnable) {
					$(slFrame).removeClass('hide');
				}
				slFrameHeight = $(slFrame).outerHeight();
				document.querySelector('body').style.marginBottom = slFrameHeight + 'px';
			} else {
				createSmartlockIframe(true);
			}
			setTimeout(function() {
				if (notNowDiv) {
					$(notNowDiv).removeClass('hide');
				}
			}, '5000');
		} else {
			// Handle logging and behavior
			// We dont expect this to happen - just in case
			login.utils.showSpinner();
			window.location.href = slData.slReturnUrl || '';
		}
	}

	// Applicable for both cookied and uncookied users where we need to check if google session is active
	// So we can offer optIn post login
	function doSessionChk() {
		// Prefer options slFrameSrc as that would be the right one in case of uncookied flow.
		var frameSrc = slData.slFrameSrc;
		var slSessionChkTimeout = slData.slSessionChkTimeout || '3000';
		var metricData = {
			stateName: 'begin_gsl_session_check',
			transitionName: 'prepare_gsl_session_check',
			apiName: 'smartlock_hintsAvailable',
			isOneTap: slData.googleOneTapEnable
		};
		startTime = getCurrentTime();

		if (frameSrc) {
			timeoutFunction = setTimeout(function() {
				onSessionChkTimeout();
			}, slSessionChkTimeout);
			// In case of retirning OT, create iframe with popup class
			createSmartlockIframe(slData.slOptInOT);
			logMetrics(metricData);
		} else {
			// log error and redirect if OT
			metricData.errorCode = 'slFrameSrc not found';
			metricData.redirectOnComplete = slData.slOptInOT;
			logMetrics(metricData);
		}
	}

	// Function to attach events on various SL clickable elements
	// makes use of global var slEventsRegistered to ensure we dont attach multiple times when we navigate
	// between SPA.
	function registerEvents() {
		var slLoginLearnMoreLink = document.querySelector('#slLoginLearnMore');
		var learnMoreModal = document.querySelector('#learnMoreModal');
		var learnMoreModalCloseBtn = learnMoreModal.querySelector('button');
		var optInLearnMoreLink = document.querySelector('#slOptInlearnMore');
		var optInModal = document.querySelector('#learnMoreModal');
		var optInModalCloseBtn = optInModal.querySelector('button');
		var acceptAndContinueSLActivation = sllanding && sllanding.querySelector('#continueBtn');
		var usePasswordInstead = sllanding && sllanding.querySelector('#secondaryLoginBtn');
		var changeLink = document.querySelector('#changeLink');
		var notNowLink = sllanding.querySelector('#slOptIn_notNow a');
		var backToInputEmailLink = document.querySelector('#backToInputEmailLink');

		// On clicking Learn More
		addEvent(slLoginLearnMoreLink, 'click', function() {
			showModal(learnMoreModal);
		});
		// On clicking close button in learn more
		addEvent(learnMoreModalCloseBtn, 'click', function() {
			hideModal(learnMoreModal);
		});
		addEvent(optInLearnMoreLink, 'click', function() {
			showModal(optInModal);
		});
		addEvent(optInModalCloseBtn, 'click', function() {
			hideModal(optInModal);
		});
		// On clicking SL activate
		addEvent(acceptAndContinueSLActivation, 'click', function() {
			activateSmartlockLogin();
		});

		addEvent(usePasswordInstead, 'click', function() {
			login.logger.log({
				evt: 'CROSS_DEVICE_OT_CLIENT',
				data: 'USE_PASSWORD_' + deviceType,
				calEvent: true
			});
			switchFromSLToLogin();
		});
		if (changeLink) {
			addEvent(changeLink, 'click', changeLinkHandler);
		}
		if (backToInputEmailLink) {
			addEvent(backToInputEmailLink, 'click', changeLinkHandler);
		}

		addEvent(window, 'message', postMessageHandler);
		if (notNowLink) {
			addEvent(notNowLink, 'click', function() {
				// Log and redirect the user to returnUrl
				logMetrics({
					stateName: 'begin_gsl',
					transitionName: 'process_gsl_not_now',
					calName: 'OPTIN_ACTION_NOTNOW_' + login.utils.getIntent(),
					redirectOnComplete: true
				});
			})
		}
		slEventsRegistered = true;
	}

	// FLow starts here - called on initialize page load, and when next button is clicked
	return function smartLock(options) {
		var nextClick = document.querySelector('input[name=nextClick]');
		slData = options ? options : window.PAYPAL && window.PAYPAL.slData;
		if (!slData || !slData.slAction || !sllanding) {
			// return early - nothing to do - SL is not enabled
			return;
		}

		if (slData.slAction && !slEventsRegistered) {
			// We got to bring some sl related UI, lets register uiClick events
			registerEvents();
		}

		login.logger.log({
			evt: 'CROSS_DEVICE_OT_CLIENT',
			data: 'IFRAME_URL_SRC_' + slData.slFrameSrc,
			calEvent: true
		});

		// Auth usecase - both cookied and uncookied
		if (slData.slAction === 'activation' && !login.utils.isAPayEnabled(options)) {
			// For cookied or uncookied SL blocking Google auth + activation flow
			return doAuth();
		}

		if (slData.slAction === 'nonblockingAuth') {
			// For cookied or uncookied SL non blocking Google auth attempt
			return doNonBlockingAuth();
		}

		if (slData.slAction === 'checkSession') {
			// For cookied or uncookied check google session
			return doSessionChk();
		}

		if (slData.slAction === 'optIn') {
			// Post login optIn for both new and and returning OT post login optIn
			return doOptIn();
		}

	};
}());

/**
 * @type {SiApple}
 */
var SiApple = (function() {
	var utils = login.utils;
	var logger = login.logger;
	/**
	 * Model data representation for SiApple
	 * @constructor
	 */
	function SiApple() {}
	SiApple.CAL_TYPE = 'SIAPPLE';

	/**
	 * Generate click event handlers dynamically
	 * @param {string} actionType
	 * @param {string} redirectUrl
	 * @private
	 */
	function generateHandleClick(actionType, redirectUrl) {
		return function onClick(e) {
			e.preventDefault();
			logger.log({
				evt: 'actionType',
				data: actionType,
				instrument: true
			});
			logger.log({
				evt: SiApple.CAL_TYPE,
				data: 'PROCESS_INTERSTITIAL_' + actionType.toUpperCase(),
				calEvent: true
			});
			logger.log({
				evt: 'state_name',
				data: 'begin_siapple_interstitial',
				instrument: true
			});
			logger.log({
				evt: 'transition_name',
				data: 'process_siapple_interstitial',
				instrument: true
			});
			logger.pushLogs();
			return window.location.assign(redirectUrl);
		}
	}

	/**
	 * Link Apple identity to PayPal identity
	 * @param {Object} data
	 * @param {string} data.idToken
	 * @param {string} data.scimContextId
	 */
	function linkIdentity(data) {
		return utils.makeServerRequestAndReturnPromise('/signin/oauth2/apple/link', {
			method: 'POST',
			data: data
		});
	}


	/**
	 * Activate Apple identity to login
	 * @param {Object} data
	 */
	function activate(data) {
		return utils.makeServerRequestAndReturnPromise('/signin/oauth2/apple/activate', {
			method: 'POST',
			data: data
		});
	}

	/**
	 * Handle identity linking and redirection
	 * @param {Object} redirectData
	 * @param {string} redirectData.idToken
	 * @param {string} redirectData.scimContextId
	 * @param {string} redirectData.returnUrl
	 */
	SiApple.handleLinkAndRedirect = function triggerLinkIdentity(redirectData) {
		redirectData = redirectData || {};
		logger.log({
			evt: SiApple.CAL_TYPE,
			data: 'PROCESS_HANDLE_LINK_AND_REDIRECT',
			calEvent: true
		});
		logger.pushLogs();
		return linkIdentity(redirectData)
			.then(function onSuccess() {
				return window.location.replace(redirectData.returnUrl);
			})
			.catch(function onError() {
				logger.log({
					evt: SiApple.CAL_TYPE,
					data: 'FAILED_HANDLE_LINK_AND_REDIRECT_AJAX',
					calEvent: true
				});
				logger.pushLogs();
				return window.location.replace(redirectData.returnUrl);
			});
	};

	/**
	 * Handle identity linking and redirection
	 * @param {Object} redirectData
	 * @param {string} redirectData.idToken
	 * @param {string} redirectData.code
	 * @param {string} redirectData.returnUrl
	 * @param {string} redirectData.requestUrl
	 */
	SiApple.handleActivateAndRedirect = function handleActivateAndRedirect(redirectData) {
		redirectData = redirectData || {};
		return activate(redirectData)
			.then(function onSuccess(response) {
				response = response || {};
				return window.location.replace(response.returnUrl || redirectData.returnUrl);
			})
			.catch(function onError() {
				return window.location.replace(redirectData.requestUrl || redirectData.returnUrl);
			});
	};

	SiApple.handleAuthFailure = function handleAuthFailure(redirectData) {
		redirectData = redirectData || {};
		logger.log({
			evt: SiApple.CAL_TYPE,
			data: 'PROCESS_HANDLE_AUTH_FAILURE',
			calEvent: true
		});
		logger.pushLogs();
		return window.location.replace(redirectData.returnUrl);
	};

	/**
	 * Trigger optin experience for Sign in with Apple
	 * @param {AppleIdp} appleIdp
	 * @param {SiAppleOptinData} optinData
	 * @static
	 */
	SiApple.triggerOptin = function triggerOptin(appleIdp, optinData) {
		logger.log({
			evt: SiApple.CAL_TYPE,
			data: 'PROCESS_TRIGGER_OPTIN',
			calEvent: true
		});
		logger.log({
			evt: 'state_name',
			data: 'begin_siapple_interstitial',
			instrument: true
		});
		logger.log({
			evt: 'transition_name',
			data: 'prepare_siapple_interstitial',
			instrument: true
		});
		logger.pushLogs();
		var authUrl = appleIdp.authUrl;
		var returnUrl = optinData.returnUrl;
		var siAppleInterstitialDOM = document.querySelector('section#siappleOptinInterstitial');
		var connectBtnDOM = siAppleInterstitialDOM && siAppleInterstitialDOM.querySelector('button.siappleConnectBtn.button.actionContinue');
		var declineBtnDOM = siAppleInterstitialDOM && siAppleInterstitialDOM.querySelector('a.siappleDecline');
		connectBtnDOM && connectBtnDOM.addEventListener('click', function onClick(e) {
			connectBtnDOM.disabled = true;
			generateHandleClick('connect', authUrl)(e);
		});
		declineBtnDOM && declineBtnDOM.addEventListener('click', function onClick(e) {
			utils.showSpinner();
			generateHandleClick('decline', returnUrl)(e)
		});
	};

	/**
	 * Trigger activate experience for Sign in with Apple
	 * @param {AppleIdp} appleIdp
	 */
	SiApple.triggerActivate = function triggerLogin(appleIdp) {
		logger.log({
			evt: SiApple.CAL_TYPE,
			data: 'PROCESS_TRIGGER_ACTIVATE',
			calEvent: true
		});
		logger.log({
			evt: 'state_name',
			data: 'begin_siapple_login',
			instrument: true
		});
		logger.log({
			evt: 'transition_name',
			data: 'prepare_siapple_login',
			instrument: true
		});
		logger.pushLogs();
		return window.location.assign(appleIdp.authUrl);
	};

	return SiApple;
})();
/**
 * @typedef AppleIdp
 * @property {boolean} isOptin
 * @property {boolean} isLinked
 * @property {string} authUrl
 */
/**
 * @typedef SiAppleOptinData
 * @property {boolean} isSiAppleOptinRequired
 * @property {string} returnUrl
 */

login.siapple = (function(SiApple) {
	var utils = login.utils;

	/**
	 * Get data attribute safely
	 * @param {Object} element
	 * @param attrName
	 */
	function getDataAttrSafe(element, attrName) {
		var $element = $(element);
		if (!$element) {
			return null;
		}
		return $element.data(attrName);
	}

	return function siapple(loginData) {
		loginData = loginData || {};
		var siAppleInterstitialDOM = document.querySelector('section#siappleOptinInterstitial');
		var siAppleRedirectDOM = document.querySelector('section#siappleRedirectInterstitial');
		var appleIdpJson = loginData.appleIdpJson || getDataAttrSafe(siAppleInterstitialDOM, 'appleIdpJson');
		var siAppleOptinDataJson = loginData.siAppleOptinDataJson || getDataAttrSafe(siAppleInterstitialDOM, 'siAppleOptinDataJson');
		var siAppleRedirectDataJson = getDataAttrSafe(siAppleRedirectDOM, 'siAppleRedirectDataJson');
		var appleIdp = utils.parseJsonSafe(appleIdpJson)|| {};
		var siAppleOptinData = utils.parseJsonSafe(siAppleOptinDataJson) || {};
		var siAppleRedirectData = utils.parseJsonSafe(siAppleRedirectDataJson) || {};
		if (siAppleOptinData.isSiAppleOptinRequired && appleIdp.authUrl && siAppleOptinData.returnUrl) {
			return SiApple.triggerOptin(appleIdp, siAppleOptinData);
		}
		if (appleIdp.isLinked && appleIdp.authUrl) {
			utils.addHiddenElementIfNotExist('isSiAppleActivationProcessing', true, document.body);
			return SiApple.triggerActivate(appleIdp);
		}
		if (siAppleRedirectData.isOptin && siAppleRedirectData.returnUrl) {
			return SiApple.handleLinkAndRedirect(siAppleRedirectData);
		}
		if (siAppleRedirectData.isLinked && siAppleRedirectData.returnUrl) {
			return SiApple.handleActivateAndRedirect(siAppleRedirectData);
		}
		if (siAppleRedirectData.isFailed && siAppleRedirectData.returnUrl) {
			return SiApple.handleAuthFailure(siAppleRedirectData);
		}
	};
})(SiApple);

document.onreadystatechange = function() {
	if (document.readyState === 'complete' && login.siapple) {
		login.siapple();
	}
};

var fingerprint = fingerprint || {};
fingerprint.lookup = (function(callback) {
	var ulData = (window.PAYPAL && window.PAYPAL.ulData) || {};

	function setAvailableAuthenticatorsInForm(authenticatorList) {
		var loginForm = document.querySelector('form[name=login]');
		var availableAAID = document.createElement('input');
		availableAAID.setAttribute('type', 'hidden');
		availableAAID.setAttribute('name', 'availableAAID');
		availableAAID.setAttribute('value', authenticatorList);

		if (loginForm) {
			loginForm.appendChild(availableAAID);
		}
	}

	function onDiscoveryCompletion(discoverResponse) {
		var availableAuthenticators;
		var availableAuthenticatorsList = [];

		if (discoverResponse && discoverResponse.availableAuthenticators !== null) {
			availableAuthenticators = discoverResponse.availableAuthenticators;
			// Success and iterate to get the list of available authenticators
			for (var i = 0; i < availableAuthenticators.length; i++) {
				availableAuthenticatorsList.push(availableAuthenticators[i].aaid);
			}
		}

		// This is intent to allow the caller to get response in the give callback function
		if (typeof callback === 'function') {
			return callback(availableAuthenticatorsList);
		}

		if (availableAuthenticatorsList.length > 0) {
			// Set the available authenticator in the ulData object for the later use for single page context
			ulData.availableAuthenticatorsList = availableAuthenticatorsList;

			// Set the available authenticator in the login form body to set opt-in criteria on post login
			setAvailableAuthenticatorsInForm(availableAuthenticatorsList);
		}
	}

	function onDiscoveryError(callback) {
		// This is intent to allow the caller to get response in the give callback function
		if (typeof callback === 'function') {
			return callback();
		}
		// do nothing for the non callback caller
	}

	// Look up
	if (ulData.fingerprintProceed === 'lookup' && navigator.uaf) {
		// Do look up
		navigator.uaf.discover(onDiscoveryCompletion, onDiscoveryError);
	}
});

fingerprint = fingerprint || {};
fingerprint.utils = (function() {
	var utils = login.utils;

	function makeServiceRequest(options, successHandler, failureHandler) {
		var data = {};
		options = options || {};

		if (options.data) {
			data = options.data;
		}
		// Set the CSRF token
		data['_csrf'] = utils.getCSRFToken();

		// Show spinner default to all XHR calls
		utils.showSpinner();
		utils.showSpinnerMessage('oneSecond');

		$.ajax({
			type: options.method || 'POST',
			url: '/signin' + (options.path || ''),
			data: data,
			dataType: 'json',
			success: function(response) {
				utils.setCSRFToken(response && response['_csrf']);
				return successHandler(response);
			},
			fail: failureHandler
		});
	}

	function cancelUafOperation(cancelUafMessage, callback) {
		if (cancelUafMessage) {
			navigator.uaf.processUAFOperation(cancelUafMessage, function(result) {
				if (typeof callback === 'function') {
					return callback()
				}
				// TODO log FPTI and CAL
			}, function(errorCode) {
				if (typeof callback === 'function') {
					return callback()
				}
				// TODO log FPTI and CAL
			});
		}
	}

	function deregisterUAFOperation(deregUafMessage) {
		if (deregUafMessage) {
			navigator.uaf.processUAFOperation(deregUafMessage, function(result) {
				// TODO log FPTI and CAL
			}, function(errorCode) {
				// TODO log FPTI and CAL
			});
		}
	}

	function getUafMessage(protocolMessage) {
		if (protocolMessage) {
			return {
				'uafProtocolMessage': protocolMessage,
				'additionalData': null
			};
		}
	}

	function fpNotYouClickHandler(event, callback) {
		eventPreventDefault(event);

		$.ajax({
			type: 'POST',
			url: '/signin/not-you',
			data: {
				'_csrf': document.querySelector('#token').value,
				notYou: true,
				intent: utils.getIntent(),
				context_id: utils.getFlowId()
			},
			dataType: 'json',
			complete: function() {
				if (typeof callback === 'function') {
					return callback();
				}
			}
		});
	}

	return {
		makeServiceRequest: makeServiceRequest,
		getUafMessage: getUafMessage,
		cancelUafOperation: cancelUafOperation,
		deregisterUAFOperation: deregisterUAFOperation,
		fpNotYouClickHandler: fpNotYouClickHandler
	};
}());

var fingerprint = fingerprint || {};
fingerprint.login = (function() {
	var ulData = (window.PAYPAL && window.PAYPAL.ulData) || {};
	var utils = login.utils;
	var retryLimit = 2; // number of retry atempts allowed. This excludes the first attempt to register fingerprint
	var USER_CANCELLED = 0x03; // IOC error code indicating user cancelled the uafOperation
	var fpLogin = document.querySelector('.fpLogin');
	var footer = document.querySelector('.footer');
	var fpLoginError = $('body').data('fpLoginError');
	var uafMessage;
	var cancelUafMessage;
	var deregUafMessage;
	var clientLogState = {evt: 'state_name', data: 'begin_fp_login', instrument: true};

	function redirectToLogin(link) {
		var href = link && link.getAttribute('href');
		var fpPromptUrl = document.querySelector('form[name=login] input[name=fpPromptWithError]');
		utils.showSpinner();
		if (href) {
			window.location.href = href;
		} else {
			window.location.href = (fpPromptUrl && fpPromptUrl.value) || window.location.href + '&fpPrompt=login';
		}
	}

	function fingerprintNotYouClickHandler() {
		var fpLoginNotYouLink = document.querySelector('#fpLoginNotYouLink');
		// Not you link handler
		if (fpLoginNotYouLink) {
			fpLoginNotYouLink.onclick = function(event) {
				event.preventDefault();
				// cancel the currently pending fingerprint scan action in the device
				fingerprint.utils.cancelUafOperation(cancelUafMessage);
				// show the spinner as we do further server calls to do the unbind and notYou
				utils.showSpinner();
				// UL server call for not-you
				// Deletes the rmuc cookie and does server side unbind
				// Post not-you we do the device dereg
				fingerprint.utils.fpNotYouClickHandler(event, function() {
					var clientLogList = [clientLogState, {
						evt: 'transition_name',
						data: 'process_fp_not_you',
						instrument: true
					}];
					// client log
					login.logger.clientLog(clientLogList, null); // Fire and forget
					// dereg the fp info from the device
					fingerprint.utils.deregisterUAFOperation(deregUafMessage);
					redirectToLogin(fpLoginNotYouLink);
				});
			};
		}
	}

	function fingerprintUsePasswordClickHandler() {
		var fpLoginUsePasswordLink = document.querySelector('.fpLoginUsePasswordLink');
		if (fpLoginUsePasswordLink) {
			fpLoginUsePasswordLink.onclick = function(event) {
				event.preventDefault();
				fingerprint.utils.cancelUafOperation(cancelUafMessage);
				utils.showSpinner();
				var clientLogList = [clientLogState, {
					evt: 'transition_name',
					data: 'process_use_password_instead',
					instrument: true
				}];
				login.logger.clientLog(clientLogList, function() {
					redirectToLogin(fpLoginUsePasswordLink);
				}); // Fire and forget
			}
		}
	}

	function uafSuccessHandler(uafResponse) {
		var protocolMessage = uafResponse && uafResponse.uafProtocolMessage;
		var loginFormInputList = document.querySelectorAll('form[name=login] input[type=hidden]');
		var kmliCb = login.utils.getKmliCb();
		var excludeInputFields = ['login_email', 'login_password', 'login_phone', 'login_pin'];
		var data = {};
		protocolMessage = JSON.parse(protocolMessage);
		if (!protocolMessage) {
			redirectToLogin();
		}
		data.uafResponse = JSON.stringify(protocolMessage);

		// This to check to validate required
		if (loginFormInputList.length) {
			// Iterate all the hidden form input field list
			for (var i = 0; i < loginFormInputList.length; i++) {
				for (var j = 0; j < excludeInputFields.length; j++) {
					if (loginFormInputList[i] && (loginFormInputList[i].name !== excludeInputFields[j])) {
						data[loginFormInputList[i].name] = loginFormInputList[i].value;
					}
				}
			}
		}

		// Set One Touch data when selected
		if (kmliCb && kmliCb.checked) {
			data['rememberMe'] = 'true';
		}

		fingerprint.utils.makeServiceRequest({data: data}, function(response) {
			if (response.returnUrl) {
				window.location.href = response.returnUrl;
			} else {
				redirectToLogin();
			}
		}, function() {
			redirectToLogin();
		});
	}

	function uafFailureHandler(errorCode) {
		var fpLoginTryAgain = document.querySelector('.fpLoginTryAgain');
		var headerIcon = document.querySelector('.headerIconThumbprint');

		// If user has cancelled the operation, no need to present retry - exit early.
		if (errorCode === USER_CANCELLED) {
			return;
		}
		if (retryLimit > 0) {
			retryLimit = retryLimit - 1;
			utils.showSpinner();
			utils.showSpinnerMessage('oneSecond');
			var clientLogList = [clientLogState, {
					evt: 'transition_name',
					data: 'process_fp_login_retry',
					instrument: true
				},
				{
					evt: 'fp_login_error',
					data: errorCode || '',
					instrument: true
				}
			];
			// client log
			login.logger.clientLog(clientLogList, null); // Fire and forget
			return setTimeout(function() {
				utils.hideSpinner();
				utils.hideSpinnerMessage('oneSecond');
				// TODO: Show the error fingerprint icon
				if (headerIcon) {
					headerIcon.className = 'headerIconThumbprintError';
				}
				if (fpLoginTryAgain) {
					$(fpLoginTryAgain).removeClass('hide');
				}
				processUafOperation(); // Initiate retry
			}, 1000);
		}
		// when exceeding retry limit, show the form login with error
		redirectToLogin();
	}

	function processUafOperation() {
		navigator.uaf.processUAFOperation(uafMessage, uafSuccessHandler, uafFailureHandler);
	}

	function loginChallengeSuccessHandler(response) {
		response = response || {};
		// set the cancel and dereg messages to be used when the user clicks cancel or not you
		cancelUafMessage = fingerprint.utils.getUafMessage(response.cancelUafRequest);
		deregUafMessage = fingerprint.utils.getUafMessage(response.deregUafRequest);
		// get the uafMessage to perform Auth
		if (response.uafRequest) {
			uafMessage = fingerprint.utils.getUafMessage(response.uafRequest);
			utils.hideSpinner();
			// Cancel first any of active operation and start the new one.
			fingerprint.utils.cancelUafOperation(cancelUafMessage, function() {
				setTimeout(processUafOperation, 500);
			});
		} else {
			// since the error is even before we ask user to scan fp, we just fallback to the email pswd screen,
			// without any error notification
			redirectToLogin();
		}
	}

	function loginChallengeFailureHandler() {
		redirectToLogin();
	}

	// Fingerprint login
	if (ulData.fingerprintProceed === 'login' && navigator.uaf) {
		// Default set the footer with monogram PayPal logo
		fingerprintNotYouClickHandler();
		fingerprintUsePasswordClickHandler();

		// Initiate the login challenge call
		fingerprint.utils.makeServiceRequest({path: '/challenge/uaf'},
			loginChallengeSuccessHandler,
			loginChallengeFailureHandler
		);
	}
});

// WebAuthn login
login.webAuthn = (function() {
	var resourceCache = login.utils.createCache();
	var utils = login.utils;
	var webAuthnCalName = 'WEBAUTH_N_CLIENT';
	var partyIdHash = $('body').data('partyIdHash');
	// for cookied wrong password page webauthn login
	if ($('body').data('webAuthnEnrolledUser')) {
		utils.addHiddenElement('webAuthnEnrolledUser', true, document.querySelector('form[name=login]'));
	}
	if (partyIdHash) {
		utils.addHiddenElement('partyIdHash', partyIdHash, document.querySelector('form[name=login]'));
	}
	function getLoginContext(model) {
		const webAuthnLoginCtx = (model && model.webAuthnLoginContext) || $('body').data('webAuthnLoginContext');
		let loginContext;
		if (!webAuthnLoginCtx) {
			if (partyIdHash) {
				login.storageUtils.removeDataByUserId('wanId', partyIdHash);
				login.logger.log({evt: 'webauthn_cred', data: 'cred_no_ctx', instrument: true});
				login.logger.log({
					evt: webAuthnCalName,
					data: 'CRED_NO_CTX',
					calEvent: true
				});
				login.logger.pushLogs();
			}
			return;
		}
		try {
			loginContext = JSON.parse(webAuthnLoginCtx);
		} catch(e){}
		return loginContext;
	}

	function insertNextSection(html) {
		const main = document.querySelector('#main');
		const sections = main.querySelectorAll('section') || [];
		for (var i = 0; i < sections.length; i++) {
			var notifications = sections[i].querySelector('.notifications');
			if (notifications && $(notifications).text()) {
				$(notifications).text('');
			}
			if (!$(sections[i]).hasClass('hide')) {
				$(sections[i]).addClass('hide');
			}
		}
		main.insertAdjacentHTML('afterbegin', html);
		login.footer && login.footer();
		if(login.countryList && login.countryList.getCache('countryList')) {
			login.countryList.showCountryDropDown();
		}
	}

	function disableEmailPasswordField() {
		const isSafari = $('body').data('loginExperience') === 'safari';
		const webAuthnLoginElement = $('#fpLogIn');
		const loginSection = $('#login');
		if (!webAuthnLoginElement || webAuthnLoginElement.hasClass('hide') ||
			!loginSection || !loginSection.hasClass('hide') || !isSafari) {
			return;
		}
		const emailDom = document.querySelector('#email');
		const passwordDom = document.querySelector('#password');
		if(emailDom && !emailDom.hasAttribute('disabled')) {
			emailDom.setAttribute('disabled', 'disabled');
		}
		if(passwordDom && !passwordDom.hasAttribute('disabled')) {
			passwordDom.setAttribute('disabled', 'disabled');
		}
	}

	function enableEmailPasswordField() {
		const emailDom = document.querySelector('#email');
		const passwordDom = document.querySelector('#password');
		if(emailDom && emailDom.hasAttribute('disabled')) {
			emailDom.removeAttribute('disabled');
		}
		if(passwordDom && passwordDom.hasAttribute('disabled')) {
			passwordDom.removeAttribute('disabled');
		}
	}

	function handleChange() {
		const changeLink = document.querySelector('.webAuthnDisplayCredentials a');
		if (changeLink) {
			addEvent(changeLink, 'click', function(event) {
				login.utils.showSpinner({ nonTransparentMask: true });
				eventPreventDefault(event);
				login.utils.notYouClickHandlerForCookiedUser(event, function() {
					login.logger.log({
						evt: 'state_name',
						data: 'begin_webauthn_login',
						instrument: true
					});
					login.logger.log({
						evt: 'transition_name',
						data: 'click_not_you',
						instrument: true
					});
					login.logger.pushLogs();
					location.reload();
				})
			});
		}
	}

	function showPassword(event) {
		eventPreventDefault(event);
		login.logger.log({
			evt: 'state_name',
			data: 'webauthn_login',
			instrument: true
		});
		login.logger.log({
			evt: 'transition_name',
			data: 'prepare_use_password_instead',
			instrument: true
		});
		login.logger.log({
			evt: 'button_label',
			data: 'use_password_instead',
			instrument: true
		});
		login.logger.log({
			evt: 'WEBAUTH_N_CLIENT',
			data: 'WEBAUTH_N_CLIENT_CLICKED_USE_PASSWORD_INSTEAD',
			calEvent: true
		});
		login.logger.pushLogs();
		const webAuthnLoginElement = document.querySelector('#fpLogIn');
		enableEmailPasswordField();
		const loginSection = $('#login');
		if (webAuthnLoginElement) {
			$(webAuthnLoginElement).remove();
		}
		if (loginSection) {
			$('#login').removeClass('hide');
		}
	}

	function showTryAnotherWayModal(event) {
		eventPreventDefault(event);
		const tryAnotherWayModal = $('#tryAnotherWayModal');
		const contentModal = $('.modal-content');
		if (!tryAnotherWayModal || !contentModal) {
			return;
		}
		login.logger.log({
			evt: 'state_name',
			data: 'webauthn_login',
			instrument: true
		});
		login.logger.log({
			evt: 'transition_name',
			data: 'try_again_modal',
			instrument: true
		});
		login.logger.log({
			evt: 'WEBAUTH_N_CLIENT',
			data: 'WEBAUTH_N_CLIENT_CLICKED_TRY_ANOTHER_WAY',
			calEvent: true
		});
		login.logger.pushLogs();
		tryAnotherWayModal.removeClass('hide');
		tryAnotherWayModal.addClass('transitioned');
		contentModal.addClass('transitioned');
	}

	function closeTryAnotherWayModal(event) {
		eventPreventDefault(event);
		const modal = document.querySelector('#tryAnotherWayModal');
		const closeButton = document.querySelector('#closeModal');
		const tryAnotherWayModal = $('#tryAnotherWayModal');
		const contentModal = $('.modal-content');
		if (!tryAnotherWayModal || !contentModal) {
			return;
		}

		if (event && event.target && event.target !== modal && event.target !== closeButton) {
			return;
		}

		login.logger.log({
			evt: 'try_another_way',
			data: 'try_another_way_close_window_clicked',
			calEvent: true
		});
		login.logger.pushLogs();

		tryAnotherWayModal.removeClass('transitioned');
		contentModal.removeClass('transitioned');
		setTimeout(function () {
			tryAnotherWayModal.addClass('hide');
		}, 400);
	}

	function showServiceErrorPage() {
		const serviceErrorPage = document.querySelector('#serviceError');
		const webAuthnDisplayCredentials = document.querySelector('.webAuthnDisplayCredentials');
		const webAuthnLoginElement = document.querySelector('#webAuthnLogin');

		if (!serviceErrorPage) {
			return;
		}
		$(serviceErrorPage).removeClass('hide');
		// hide the webauthn credentials header, if available on the page
		if (webAuthnDisplayCredentials) {
			$(webAuthnDisplayCredentials).addClass('hide');
		}

		if (webAuthnLoginElement) {
			$(webAuthnLoginElement).addClass('hide');
		}

		login.logger.log({
			evt: 'state_name',
			data: 'webauthn_login',
			instrument: true
		});
		login.logger.log({
			evt: 'transition_name',
			data: 'prepare_error_page',
			instrument: true
		});

		login.logger.log({
			evt: 'SERVICE_ERROR_PAGE',
			data: 'SHOW_ERROR_PAGE_LOGIN',
			calEvent: true
		});
		login.logger.pushLogs();
	}

	function attachServiceErrorPageHandlers() {
		const serviceErrorPage = document.querySelector('#serviceError');
		const errorUsePasswordInstead = document.querySelector('#errorUsePasswordInstead');
		if (!serviceErrorPage || !errorUsePasswordInstead) {
			return;
		}
		addEvent(errorUsePasswordInstead, 'click', showPassword);
	}
	function attachTryAnotherWayModalHandlers() {
		const closeModal = document.querySelector('#closeModal');
		const guestCheckout = document.querySelector('#guestCheckout');
		const loginWithOtp = document.querySelector('#loginWithOtp');
		const loginWithPassword = document.querySelector('#loginWithPassword');
		const tryAnotherWayModal = document.querySelector('#tryAnotherWayModal');

		if (!tryAnotherWayModal) {
			return;
		}

		addEvent(tryAnotherWayModal, 'click', closeTryAnotherWayModal);
		if (closeModal) {
			addEvent(tryAnotherWayModal, 'click', closeTryAnotherWayModal);
		}
		if (guestCheckout) {
			addEvent(guestCheckout, 'click', function(e) {
				eventPreventDefault(event);
				login.utils.getOutboundLinksHandler(guestCheckout)(e);
				login.logger.log({
					evt: 'try_another_way',
					data: 'checkout_as_guest_clicked',
					instrument: true
				});
				login.logger.pushLogs();
			});
		}

		if (loginWithOtp) {
			addEvent(loginWithOtp, 'click', function() {
				eventPreventDefault();
				if (!login.otp) {
					return;
				}
				login.logger.log({
					evt: 'state_name',
					data: 'begin_account_exists',
					instrument: true
				});
				login.logger.log({
					evt: 'transition_name',
					data: 'click_otp_link',
					instrument: true
				});
				login.logger.pushLogs();
				login.otp.prepareSendPage({integrationType: 'onTryAnotherWayModal', otpLoginEligible: 'true'});
			});
		}

		if (loginWithPassword) {
			addEvent(loginWithPassword, 'click', showPassword);
		}
	}

	function webAuthnLoginHandler(event) {
		const isUvpaaExist = $('body').data('isUvpaaExist');
		eventPreventDefault(event);
		login.logger.log({
			evt: 'state_name',
			data: 'webauthn_login',
			instrument: true
		});
		login.logger.log({
			evt: 'transition_name',
			data: 'prepare_login',
			instrument: true
		});
		login.logger.log({
			evt: 'button_label',
			data: 'log_in',
			instrument: true
		});
		login.logger.log({
			evt: 'WEBAUTH_N_CLIENT',
			data: 'WEBAUTH_N_CLIENT_CLICKED_WEBAUTHN_LOGIN',
			calEvent: true
		});
		login.logger.pushLogs();
		// avoid request pending error from API response
		if (isUvpaaExist === 'false') {
			login.logger.log({
				evt: 'WEBAUTH_N_CLIENT',
				data: 'ERROR_UVPAA_NOT_ENABLED',
				calEvent: true
			});
			login.logger.pushLogs();
			return showServiceErrorPage();
		}
		login.webAuthn.performWebAuthnLogin();
	}

	function attachFormEvent() {
		var webAuthnLoginElement = $('#fpLogIn');
		if (!webAuthnLoginElement) {
			return;
		}
		const webAuthnLoginButton = document.querySelector('#logIn_start');
		const webAuthnUsePasswordInstead = document.querySelector('#logIn_notNow');
		const webAuthnTryAnotherWay = document.querySelector('#logIn_tryAnotherWay');
		const serviceErrorPage = document.querySelector('#serviceError');
		addEvent(webAuthnLoginButton, 'click', webAuthnLoginHandler);
		if (webAuthnUsePasswordInstead) {
			addEvent(webAuthnUsePasswordInstead, 'click', showPassword);
		}
		if (webAuthnTryAnotherWay) {
			attachTryAnotherWayModalHandlers();
			addEvent(webAuthnTryAnotherWay, 'click', showTryAnotherWayModal);
		}
		if (serviceErrorPage) {
			attachServiceErrorPageHandlers();
		}
		handleChange();
	};

	function renderPage(page) {
		insertNextSection(page);
		attachFormEvent();
	}

	function performWebAuthnLogin(model) {
		const webAuthnStartTime = $('body').data('loadStartTime');
		const loginContext = getLoginContext(model);
		if (typeof navigator.credentials !== 'object' ||
			typeof navigator.credentials.get !== 'function') {
			return;
		}
		login.logger.log({
			evt: 'state_name',
			data: 'webauthn_login',
			instrument: true
		});
		login.logger.log({
			evt: 'transition_name',
			data: 'prepare_consent',
			instrument: true
		});
		login.logger.log({
			evt: webAuthnCalName,
			data: `${webAuthnCalName}_PREPARE_CONSENT_LOGIN`,
			calEvent: true
		});
		login.logger.pushLogs();
		function getAssertion() {
			var loginCtx = loginContext || {};
			var assertionOptions = {
				authenticatorSelection: {
					authenticatorAttachment: 'platform'
				},
				attestation: 'direct',
				userVerification: 'preferred'
			};

			assertionOptions.challenge = str2buff(loginCtx.challenge);
			if ('timeout' in loginCtx) {
				assertionOptions.timeout = loginCtx.timeout;
			}
			if ('rpId' in loginCtx) {
				assertionOptions.rpId = loginCtx.rpId;
			}
			if ('allowCredentials' in loginCtx) {
				assertionOptions.allowCredentials = credentialListConversion(loginCtx.allowCredentials);
			}
			return navigator.credentials.get({'publicKey': assertionOptions})
		}

		function buff2str(strBuff) {
			return btoa(
				new Uint8Array(strBuff).reduce(function(s, byte) {
					return s + String.fromCharCode(byte)
				}, ''));
		}

		function str2buff(str) {
			return Uint8Array.from(atob(str), function(c) {
				return c.charCodeAt(0);
			});
		}

		function credentialListConversion(list) {
			var result = [];
			for (var i = 0; i < list.length; i++) {
				var credential = {};
				credential.type = list[i].type;
				credential.id = str2buff(list[i].id);
				credential.transports = ['internal'];
				result.push(credential);
			}
			return result;
		}

		function proceedLogin(assertion) {
			var loginFormInputList = document.querySelectorAll('form[name=login] input[type=hidden]');
			var publicKeyCredential = {};
			var data = {};
			var emailField = document.querySelector('input[name=login_email]');
			var phoneField = document.querySelector('input[name=login_phone]');
			var phoneCode = document.querySelector('#phoneCode');

			login.logger.log({evt: 'state_name', data: 'webauthn_login', instrument: true});
			login.logger.log({evt: 'transition_name', data: 'prepare_proceed_login', instrument: true});
			login.logger.log({
				evt: webAuthnCalName,
				data: `${webAuthnCalName}_PREPARE_PROCEED_LOGIN`,
				calEvent: true
			});
			login.logger.pushLogs();

			// Iterate all the hidden form input field list
			for (var i = 0; i < loginFormInputList.length; i++) {
				data[loginFormInputList[i].name] = loginFormInputList[i].value;
			}

			if (phoneField && phoneField.value && phoneCode && phoneCode.value) {
				data.login_phone = phoneField.value;
				data.phoneCode = phoneCode.value;
			} else {
				data.login_email = emailField && emailField.value;
			}

			if ('id' in assertion) {
				publicKeyCredential.id = assertion.id;
			}
			if ('type' in assertion) {
				publicKeyCredential.type = assertion.type;
			}
			if ('rawId' in assertion) {
				publicKeyCredential.rawId = buff2str(assertion.rawId);
			}
			if ('response' in assertion) {
				var response = {};
				response.clientDataJSON = buff2str(assertion.response.clientDataJSON);
				response.authenticatorData = buff2str(assertion.response.authenticatorData);
				response.signature = buff2str(assertion.response.signature);
				response.userHandle = buff2str(assertion.response.userHandle);
				publicKeyCredential.response = response;
				data.webauthn_response = JSON.stringify(publicKeyCredential);
				// TODO: Add tracking for preparing webauthn login and skip the default login page fpti event
				return utils.makeServerRequestAndReturnPromise('/signin', {
					data: data
				});
			} else {
				return Promise.reject();
			}
		}

		getAssertion()
			.then(proceedLogin)
			.catch(function(e) {
				// This catch is for the `getAssertion` promise failure
				// At this point assertion has failed which means either user cancelled
				// or implies wrong user/finger with correct credential for the device
				utils.addHiddenElement('webAuthnEnrolledUser', true, document.querySelector('form[name=login]'));
				login.logger.log({evt: 'state_name', data: 'begin_fp_login', instrument: true});
				login.logger.log({evt: 'transition_name', data: 'process_fp_assertion_failed', instrument: true});
				login.logger.log({
					evt: webAuthnCalName,
					data: 'PROCESS_FP_ASSERTION_FAILED',
					calEvent: true,
					status: 'ERROR'
				});
				var errorMessage = (e && e.toString()) || 'unknown_error';
				login.logger.log({
					evt: webAuthnCalName,
					data: 'FP_ASSERTION_ERROR_' + errorMessage,
					calEvent: true
				});
				login.logger.log({
					evt: 'ext_error_desc',
					data: errorMessage,
					instrument: true
				});
				return Promise.reject(); // This reject will avoid hitting the next then in case of assertion failure.
			})
			.then(function(response) {
				if (response.notifications) {
					return Promise.reject('service error');
				}
				// WebAuthn Login succeeded
				login.logger.log({evt: 'state_name', data: 'begin_fp_login', instrument: true});
				login.logger.log({evt: 'transition_name', data: 'process_fp_login_success', instrument: true});
				login.logger.log({
					evt: webAuthnCalName,
					data: 'PROCESS_FP_LOGIN_SUCCESS',
					calEvent: true
				});
				login.logger.pushLogs();
				login.utils.logCPLData({startTime: webAuthnStartTime, status:'success', flowName: 'Web Authn'});
				if (response.returnUrl) {
					window.location.href = response.returnUrl;
				} else {
					utils.hideSpinner();
				}
			})
			.catch(function(e) {
				login.logger.log({evt: 'state_name', data: 'begin_fp_login', instrument: true});
				login.logger.log({evt: 'transition_name', data: 'process_fp_login_failed', instrument: true});
				login.logger.log({
					evt: webAuthnCalName,
					data: 'PROCESS_FP_LOGIN_FAILED',
					calEvent: true,
					status: 'ERROR'
				});
				login.logger.pushLogs();
				login.utils.logCPLData({startTime: webAuthnStartTime, status:'failure', flowName: 'Web Authn'});
				utils.hideSpinner();
				if (e !== 'service error') {
					return;
				}
				showServiceErrorPage();
			});
	}

	function setUVPAAInForm(model) {
		var webAuthnPubKeyCred = window.PublicKeyCredential;
		var isUVPAA = true;
		// Reference: https://www.w3.org/TR/webauthn/#isUserVerifyingPlatformAuthenticatorAvailable
		if (webAuthnPubKeyCred && webAuthnPubKeyCred.isUserVerifyingPlatformAuthenticatorAvailable) {
			login.logger.log({
				evt: 'state_name',
				data: 'begin_fp_UVPAA',
				instrument: true
			});
			login.logger.log({
				evt: 'transition_name',
				data: 'process_fp_UVPAA',
				instrument: true
			});
			webAuthnPubKeyCred.isUserVerifyingPlatformAuthenticatorAvailable().then(function(response) {
				login.logger.log({
					evt: 'eligibility_reason',
					data: 'UVPAA_' + response,
					instrument: true
				});
				login.logger.log({
					evt: webAuthnCalName,
					data: 'UVPAA_ELIGIBLE_' + response,
					calEvent: true,
					status: 'SUCCESS'
				});
				login.logger.pushLogs();
				if (response === true) {
					utils.addHiddenElementIfNotExist('isUVPAAExist', 'yes', document.querySelector('form[name=login]'));
					document.body.setAttribute('data-is-uvpaa-exist', 'true');
				}
				if (response === false) {
					isUVPAA = false;
					document.body.setAttribute('data-is-uvpaa-exist', 'false');
					return Promise.reject(new Error('UVPAA not eligible'));
				}
				return Promise.resolve(isUVPAA);
			})
				.then(function() {
					// Add a flag to the form body so that post login webauthn opt-in is not shown to this user
					if (model && model.webAuthnEnrolledUser) {
						utils.addHiddenElement('webAuthnEnrolledUser', true, document.querySelector('form[name=login]'));
					}
					const webAuthnLoginElement = $('#fpLogIn');
					const loginSection = $('#login');
					if (webAuthnLoginElement && !webAuthnLoginElement.hasClass('hide')) {
						loginSection.addClass('hide');
						disableEmailPasswordField();
					}
					utils.hideSpinner();
				})
				.catch(function(e) {
					utils.hideSpinner();
					login.logger.log({
						evt: 'eligibility_reason',
						data: 'UVPAA_error',
						instrument: true
					});
					login.logger.log({
						evt: webAuthnCalName,
						data: 'UVPAA_CHECK_FAILED',
						calEvent: true,
						status: 'ERROR'
					});
					login.logger.pushLogs();
					document.body.setAttribute('data-is-uvpaa-exist', 'false');
			});
		}
	}
	return {
		setContext: function (model) {
			var webAuthnSupportLookup = (model && model.wanSupportLookup) || $('body').data('webAuthnSupportLookup');
			var ulData = window.PAYPAL.ulData || {};
			var aPayAuth = ulData.aPayAuth;
			var isUserDeviceTokenLoginEligible = $('body').data('userDeviceTokenLogin');

			// for UVPAA eligibility will check if Apay eligible and Weblls eligible here
			// OT and sso eligibility are checked from clientside
			// if Apay eligible and not softdecline (!canNotMakePayment) go with Apay not eligible here
			// if Apay eliigible and softdecline (canNotMakePayment) go with OT login
			if (!webAuthnSupportLookup || aPayAuth || isUserDeviceTokenLoginEligible) {
				return;
			}
			if(model && model.webAuthnLoginHtml) {
				resourceCache.update({webAuthnLoginPage: model.webAuthnLoginHtml});
				renderPage(model.webAuthnLoginHtml);
			}
			setUVPAAInForm(model);
		},
		performWebAuthnLogin: performWebAuthnLogin,
		attachFormEvent: attachFormEvent
	};
}());

// webauthn Optin XHR
login.webAuthnOptInXHR = (function() {
	function buff2str(strBuff) {
		return btoa(
			new Uint8Array(strBuff).reduce(function(s, byte) {
				return s + String.fromCharCode(byte)
			}, ''));
	}

	function str2buff(str) {
		return Uint8Array.from(atob(str), function(c) {
			return c.charCodeAt(0);
		});
	}
	function makeCredential(result) {
		var createParam = {};
		var response;

		if (!result.response) {
			throw new Error('no_bind_challenge_available');
		}

		response = result.response || {};
		createParam.publicKey = {
			rp: {
				id: response.rp.id,
				name: response.rp.name
				// icon: response.rp.icon
			},
			user: {
				id: str2buff(response.user.id),
				name: response.user.name || '',
				displayName: response.user.displayName || ''
				// icon: response.user.icon || ''
			},
			challenge: str2buff(response.challenge),
			pubKeyCredParams: response.pubKeyCredParams,
			authenticatorSelection: {
				authenticatorAttachment: 'platform'
			}
		};
		return navigator.credentials.create(createParam);
	}
	function finishCredential(credentialResponse) {
		var publicKeyCredential = {};

		if ('id' in credentialResponse) {
			publicKeyCredential.id = credentialResponse.id;
		}
		if ('type' in credentialResponse) {
			publicKeyCredential.type = credentialResponse.type;
		}
		if ('rawId' in credentialResponse) {
			publicKeyCredential.rawId = buff2str(credentialResponse.rawId);
		}
		if ('response' in credentialResponse) {
			var response = {};
			response.clientDataJSON = buff2str(credentialResponse.response.clientDataJSON);
			response.attestationObject = buff2str(credentialResponse.response.attestationObject);
			publicKeyCredential.response = response;
			return login.utils.makeServerRequestAndReturnPromise('/signin/webauthn/process-credential', {
				data: {
					webauthn_response: JSON.stringify(publicKeyCredential),
					flowId : login.utils.getFlowId()
				}
			});
		} else {
			return Promise.reject(false);
		}
	}
	return function register() {
		var webAuthnCalName = 'WEBAUTH_N_CLIENT';
		return login.utils.makeServerRequestAndReturnPromise('/signin/webauthn/get-create-challenge', {
			data:{
				flowId: login.utils.getFlowId()
			}
		})
			.then(makeCredential)
			.catch(function(e) {
				// This catch is for Promise failed from register
				login.logger.log({evt: 'fp_optin_error', data: 'create_credential_failed_XHR', instrument: true});
				var errorMessage = (e && e.toString()) || 'unknown_error';
				login.logger.log({
					evt: webAuthnCalName,
					data: 'CREATE_CREDENTIAL_FAILED_XHR' + errorMessage,
					status: 'ERROR',
					calEvent: true
				});
				login.logger.log({
					evt: 'ext_error_desc',
					data: errorMessage,
					instrument: true
				});
			})
			.then(finishCredential)
			.catch(function() {
				// This catch is for Promise failed from makeCredential
				login.logger.log({evt: 'fp_optin_error', data: 'process_credential_failed', instrument: true});
				login.logger.log({
					evt: webAuthnCalName,
					data: 'PROCESS_CREDENTIAL_FAILED',
					status: 'ERROR',
					calEvent: true
				});
			})
			.then(function(response) {
				if (!response || !response.bindSuccess) {
					return Promise.reject(false);
				}
				var partyIdHash = document.body.getAttribute('data-party-id-hash');
				if (response.wanId && partyIdHash) {
					login.storageUtils.setDataByUserId('wanId', response.wanId, partyIdHash);
				}
				return Promise.resolve({
					msg: 'success'
				});
			})
			.catch(function() {
				// This is catch-all Promise failed from finishCredential as well as this entire promise chain
				login.logger.log({evt: 'fp_optin_error', data: 'bind_credential_failed', instrument: true});
				login.logger.log({
					evt: webAuthnCalName,
					data: 'BIND_CREDENTIAL_FAILED',
					calEvent: true
				});
				login.logger.pushLogs();
				return Promise.reject(false);
			})
	}
}());

/**
 * @type {Sua}
 */
var Sua = (function() {
	var utils = login.utils;
	var logger = login.logger;
	/**
	 * Model for Secondary User Agreement
	 * @property {HTMLElement} suaInterstitialDOM
	 * @property {HTMLElement} acceptBtnDOM
	 * @constructor
	 */
	function Sua() {}
	Sua.CAL_TYPE = 'SUA';
	Sua.ACTION_ACCEPT = 'accept';
	Sua.Action_DECLINE = 'decline';

	/**
	 * Make HTTP call to accept agreement
	 * @param {Context & SuaData} payload
	 * @param {function} callback
	 */
	function acceptAgreement(payload, callback) {
		utils.showSpinner();
		payload = payload || {};
		payload['_csrf'] = utils.getCSRFToken();
		return $.ajax({
			url: '/signin/sua/handle/accept-agreement',
			method: 'POST',
			data: payload,
			success: function onSuccess() {
				return callback();
			},
			fail: function onFailure(err) {
				return callback(err || 'unexpected');
			}
		});
	}

	/**
	 * Handle click event for the accept button
	 * @param {string} actionType
	 * @param {Context & SuaData?} payload
	 */
	function generateHandleClick(actionType, payload) {
		return function onClick(e) {
			eventPreventDefault(e);
			logger.log({
				evt: Sua.CAL_TYPE,
				data: 'PROCESS_INTERSTITIAL_' + actionType.toUpperCase(),
				calEvent: true
			});
			logger.pushLogs();
			var declineUrl = '/signin/signout?returnUri=' + encodeURIComponent(payload.returnUrl);
			if (actionType !== Sua.ACTION_ACCEPT) {
				return window.location.href = declineUrl;
			}
			return acceptAgreement(payload, function onResponse(err) {
				if (err) {
					logger.log({
						evt: Sua.CAL_TYPE,
						data: 'FAILED_ACCEPT_AGREEMENT_AJAX',
						calEvent: true
					});
					logger.pushLogs();
					return window.location.href = declineUrl; // in case of error, should logout the users
				}
				return window.location.href = payload.returnUrl;
			});
		};
	}

	/**
	 * Retrieve context-related variables to preserve context through HTTP calls
	 * @private
	 * @returns {Context}
	 */
	function getContext() {
		return {
			ctxId: utils.getCtxId(),
			intent: utils.getIntent(),
			returnUri: utils.getReturnUri(),
			state: utils.getReturnUriState(),
			flowId: utils.getFlowId()
		};
	}

	/**
	 * Get data for Secondary User Agreement
	 * @param {Element} suaInterstitialDOM
	 */
	function getSuaData(suaInterstitialDOM) {
		var data = {};
		data.suaNonce = suaInterstitialDOM && $(suaInterstitialDOM).data('suaNonce');
		data.returnUrl = suaInterstitialDOM && $(suaInterstitialDOM).data('returnUrl');
		return data;
	}

	/**
	 * @param {string} html
	 */
	function mountInterstitial(html) {
		var mainDOM = document.querySelector('div#main');
		$(mainDOM).addClass('hide');
		var xhrContainerDOM = document.createElement('div');
		$(xhrContainerDOM).addClass('xhr-container');
		xhrContainerDOM.innerHTML = html;
		document.body.appendChild(xhrContainerDOM);
	}

	/**
	 * Trigger Secondary User Agreement interstitial
	 * @param {string?} suaHtml provided only if XHR login
	 */
	Sua.triggerInterstitial = function triggerInterstitial(suaHtml) {
		if (suaHtml) {
			mountInterstitial(suaHtml);
		}
		var suaInterstitialDOM = document.querySelector('#sua-interstitial');
		var acceptBtnDOM = suaInterstitialDOM.querySelector('button.sua-agree');
		var logoutBtnDOM = suaInterstitialDOM.querySelector('a.sua-log-out');
		var context = getContext();
		var data = getSuaData(suaInterstitialDOM);
		var payload = Object.assign({}, context, data);
		acceptBtnDOM.addEventListener('click', generateHandleClick(Sua.ACTION_ACCEPT, payload));
		logoutBtnDOM.addEventListener('click', generateHandleClick(Sua.Action_DECLINE, payload));
	};

	return Sua;
})();
/**
 * @typedef Context
 * @property {string} ctxId
 * @property {string} intent
 * @property {string} returnUri
 * @property {string} state
 * @property {string} flowId
 */
/**
 * @typedef SuaData
 * @property {string} suaNonce
 * @property {string} returnUrl
 */
/**
 * @typedef AcceptAgreementPayload
 * @property {Context} context
 * @property {SuaData} data
 */

login.sua = (function(Sua) {
	return function sua(loginData) {
		loginData = loginData || {};
		var isSuaRequired = loginData.isSuaRequired || $('body').data('isSuaRequired');
		var suaHtml = loginData.suaHtml;
		if (isSuaRequired) {
			return Sua.triggerInterstitial(suaHtml);
		}
	};
})(Sua);

login.geoEnablement = (function() {
	var GEO_ENABLEMENT_CAL_TYPE = 'GEO_ENABLEMENT';
	var logger = login.logger;

	function geoEnablement() {}

	/**
	 * Set Geo message with a redirection link on public auth
	 * @param {Object} model
	 * @returns {void}
	 */
	geoEnablement.setGeoMessage = function setGeoMessage(model) {
		model = model || {};
		var geoRedirectUrl = $('body').data('geoRedirectUrl') || model.geoRedirectUrl;
		var isGeoAutoRedirectEnabled = $('body').data('isGeoAutoRedirectEnabled') || model.isGeoAutoRedirectEnabled;
		var geoRedirectUrlDom = document.querySelector('p.notification > a.geoRedirectUrl');
		if (!geoRedirectUrlDom || !geoRedirectUrl) {
			return;
		}
		geoRedirectUrlDom.addEventListener('click', function onClick() {
			logger.log({
				evt: GEO_ENABLEMENT_CAL_TYPE,
				data: 'USER_CLICKED_GEO_REDIRECT_LINK',
				calEvent: true
			});
			logger.log({
				evt: 'actionType',
				data: 'geo_redirect_link',
				instrument: true
			});
			logger.pushLogs();
			return window.location.href = geoRedirectUrl;
		});
		if (isGeoAutoRedirectEnabled) {
			logger.log({
				evt: GEO_ENABLEMENT_CAL_TYPE,
				data: 'TRIGGERED_AUTO_REDIRECTION',
				calEvent: true
			});
			logger.log({
				evt: 'actionType',
				data: 'geo_auto_redirection',
				instrument: true
			});
			logger.pushLogs();
			window.location.assign(geoRedirectUrl);
		}
	};

	return geoEnablement;
})();

/**
 * Initializes an object that has methods to render validation checks on the page
 * @param {Element} form the form tag that has the input field as it's child
 * @param {Element} insideLink clickable link rendered inside the input field (move when validation error shows)
 * @param {Function} rule function that returns the rule check and result of the input field's value's validity
 */
function validateOneField(form, insideLink, rule) {
	var textInput = form.querySelector('.textInput');
	var errorMessage = textInput.querySelector('.errorMessage');
	var emptyError = textInput.querySelector('.emptyError');
	var invalidError = textInput.querySelector('.invalidError');

	// Error validation and styling
	function showError(field) {
		$(textInput).addClass('hasError');
		textInput.style['z-index'] = 100;
		$(errorMessage).addClass('show');
		insideLink && $(insideLink).addClass('moveLeft');
	}

	function showRequiredError() {
		$(emptyError).removeClass('hide');
	}

	function showInvalidError() {
		$(invalidError).removeClass('hide');
	}

	function hideRequiredError() {
		$(emptyError).addClass('hide');
	}

	function hideInvalidError() {
		$(invalidError).addClass('hide');
	}

	function hideError(removeErrHighlight) {
		if (removeErrHighlight) {
			$(textInput).removeClass('hasError');
			insideLink && $(insideLink).removeClass('moveLeft');
		}
		textInput.style['z-index'] = 1;
		$(errorMessage).removeClass('show');
	}

	function checkEmpty(field) {
		var value;

		if (!field) {
			return true;
		}

		value = field.value && field.value.trim();
		if ($(field).hasClass('validateEmpty') && !value) {
			showError(field);
			showRequiredError();
			return true;
		}
		return false;
	}

	function checkValid(field) {
		var value;

		if (!field) {
			return false;
		}

		value = field.value && field.value.trim();
		if ($(field).hasClass('validate') && rule(value)) {
			hideRequiredError();
			showError(field);
			showInvalidError();
			return false;
		}
		return true;
	}

	return {
		showError: showError,
		showRequiredError: showRequiredError,
		checkEmpty: checkEmpty,
		showInvalidError: showInvalidError,
		hideRequiredError: hideRequiredError,
		hideInvalidError: hideInvalidError,
		hideError: hideError,
		checkValid: checkValid
	}
}

function verifyOtp() {
	var verifyOtpForm = document.querySelector('form[name=verifyOtp]');
	var securityCode = document.querySelector('#security_code');
	var resendLink = document.querySelector('#resendLink');
	var resend = document.querySelector('.resend');
	var secondaryLink = document.querySelector('.secondaryLink a');
	var validator = validateOneField(verifyOtpForm, resend, function(value) {
		return value && value.length !== 6;
	});

	function validateInputs() {
		var isEmpty = validator.checkEmpty(securityCode);
		if (!isEmpty) {
			return validator.checkValid(securityCode);
		}
	}

	// Event listeners
	function handleKeyDown(event) {
		var target = getEventTarget(event);
		eventStopPropagation(event);
		validator.hideInvalidError();
		validator.hideError(true);
	}

	function handleBlur(event) {
		var target = getEventTarget(event);
		eventStopPropagation(event);
		validator.checkValid(target);
		validator.hideError();
	}

	function handleFocus(event) {
		var target = getEventTarget(event);
		eventStopPropagation(event);
		validator.checkValid(target);
	}

	function handleSubmit(event) {
		var token = document.querySelector('#token') || {};
		var notifications = document.querySelector('.notifications');
		var formData = {};
		var target, inputs, button;
		var otpStartTime;
		eventPreventDefault(event);
		target = getEventTarget(event);
		inputs = target.querySelectorAll('input') || [];
		button = target.querySelector('button');

		function handleNotifications(notificationInfo) {
			$(notifications).text('');
			if (notificationInfo && notificationInfo.msg) {
				notifications.innerHTML = '<p class="notification ' +
					notificationInfo.type + '" role="alert">' + notificationInfo.msg + '</p>';
			}
		}
		function handleXhrSuccess(response) {
			login.utils.logCPLData({startTime: otpStartTime, status:'success', flowName: 'OTP'});
			response = response || {};
			if (response.notifications) {
				handleNotifications(response.notifications);
				token.value = response._csrf;
				login.utils.hideSpinner();
			}

			if (response.disableSubmit && button) {
				$(button).addClass('greyBackground');
				$('.otpLoginViaLink') && $('.otpLoginViaLink').remove();
				button.setAttribute('disabled', 'disabled');
			}

			if (response.disableResend && resendLink) {
				$(resendLink).addClass('greyOut');
				resendLink.removeAttribute('href');
			}

			if (PAYPAL.unifiedLoginInlinePostMessage) {
				login.utils.sendPostMessage(response.showSuccess ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED');
				return;
			}

			if (response.showPassword) {
				login.pubsub.publish('SHOW_PASSWORD');
				login.utils.hideSpinner();
			}

			if (response.isCookieDisabledRequest && response.accessToken && response.returnUrl) {
				login.logger.log({
					evt: 'OTP_LOGIN',
					data: 'PROCESS_SLR_INTERNAL_REDIRECT',
					calEvent: true
				});
				login.logger.pushLogs();
				return login.utils.handleSlrInternalRedirect(response);
			}

			if (response.returnUrl) {
				setTimeout(function() {
					window.location.href = response.returnUrl;
				}, 1000);
			}
		}

		if (!validateInputs()) {
			securityCode.focus();
			return;
		}
		login.fn.updateFnSyncContext({sourceId: 'OTP_LOGIN'});
		login.fn.addFnSyncData();
		$(notifications).text('');
		for (var i = 0; i < inputs.length; i++) {
			formData[inputs[i].name] = inputs[i].value;
		}
		otpStartTime = $('body').data('loadStartTime');
		login.utils.showSpinner();
		$.ajax({
			url: target.getAttribute('action'),
			type: 'POST',
			data: formData,
			success: handleXhrSuccess,
			fail: function() {
				login.utils.logCPLData({startTime: otpStartTime, status:'failure', flowName: 'OTP'});
				login.utils.hideSpinner();
			}
		});
	}

	function handleResend(event) {
		var target = getEventTarget(event);
		var formData = {};
		var token = document.querySelector('#token') || {};
		var challengeId = document.querySelector('[name=challengeId]') || {};
		var nonce = document.querySelector('[name=nonce]') || {};
		var otpVariant = document.querySelector('[name=otpVariant]') || {};
		var sentText = document.querySelector('.sent');
		var failedText = document.querySelector('.failed');
		var link = target.getAttribute('href');

		eventPreventDefault(event);
		removeEvent(target, 'click', handleResend);
		$(target).addClass('greyOut');
		target.removeAttribute('href');
		formData[token.name] = token.value;
		formData[challengeId.name] = challengeId.value;
		formData[nonce.name] = nonce.value;
		formData[otpVariant.name] = otpVariant.value;
		formData.isResend = 'true';

		function reAttach(resendResultEle) {
			setTimeout(function() {
				$(target).removeClass('greyOut');
				$(target).removeClass('hide');
				target.setAttribute('href', link);
				if (resendResultEle) {
					$(resendResultEle).addClass('hide');
				}
				addEvent(resend, 'click', handleResend);
			}, 2000);
		}

		function handleResendResponse(response) {
			response = response || {};
			var resendResultEle = (response.resendFailed) ? failedText : sentText;
			token.value = response._csrf;
			$(target).addClass('hide');
			$(resendResultEle).removeClass('hide');
			reAttach(resendResultEle);
		}

		login.logger.log({
			evt: 'state_name',
			data: 'begin_verify_otp',
			instrument: true
		});
		login.logger.log({
			evt: 'transition_name',
			data: 'process_resend_sms',
			instrument: true
		});
		login.logger.pushLogs();

		$.ajax({
			url: link,
			type: 'POST',
			data: formData,
			success: handleResendResponse,
			fail: function() {
				reAttach();
			}
		});
	}

	function attachFormEvents() {
		addEvent(verifyOtpForm, 'submit', handleSubmit);
		addEvent(securityCode, 'keydown', handleKeyDown);
		addEvent(securityCode, 'focus', handleFocus);
		addEvent(securityCode, 'blur', handleBlur);
		addEvent(resendLink, 'click', handleResend);
		// when input is typed and invalid and resend is clicked
		// blur is fired. It is show the error message and won't
		// fire the resend and for the user it is like focussing
		// on the input field. So, the validation message should
		// side down to the user.
		addEvent(resendLink, 'focus', function() {
			securityCode.focus();
		});
		securityCode.focus();
	}

	return {
		attachFormEvents: attachFormEvents
	};
}

function verifyOtpPrimary(otpIntegrationType) {
	var resendLink = document.querySelector('#resendLink');
	var tryAnotherWayLink =  document.querySelector("#tryAnotherWayLink");
	var secondaryLink = document.querySelector('.secondaryLink');
	var boxes = document.querySelectorAll('#security_code > *[id]');
	var firstBox = document.querySelector('#otp1');
	var invalidChars = ["-", "+", "e"];
	var regex = /^[0-9]$/;
	var keyCodes = {
		'v': 86,
		'ctrl': 17,
		'cmd': 91
	};
	var keys = {
		'ctrl': 'Control',
		'cmd': 'Meta'
	};

	var cmdKeyCode = keyCodes['cmd'];
	var ctrlKeyCode = keyCodes['ctrl']
	var vKeyCode = keyCodes['v']
	var cmdKey = keys['cmd'];
	var ctrlKey = keys['ctrl'];

	var entryType;

	// Event listeners
	function handleFocus(event) {
		var target = getEventTarget(event);
		eventStopPropagation(event);
		var index = target.index;
		for (var item = 1; item < index; item++) {
			var currentElement = document.querySelector('#otp' + item);
			if (!currentElement.value) {
				currentElement.focus();
				break;
			}
		}
	}

	function handleKeyDown(event) {
		var eventCode = event.which || event.keyCode;
		// input validation
		if(eventCode !== vKeyCode && (eventCode !== cmdKeyCode || event.key !== cmdKey) && (eventCode !== ctrlKeyCode || event.key !== ctrlKey)) { // ignoring keyboard paste cmd+v & ctrl+v - handled in paste event
			if (invalidChars.indexOf(event.key) !== -1 || !regex.test(event.key) || event.target.value) {
				event.preventDefault();
				return;
			}
		}
	}

	function handleKeyUp(event) {
		var target = getEventTarget(event);
		var index = target.index;
		var eventCode = event.which || event.keyCode;
		var previousBox = document.querySelector('#otp' + (index - 1));
		var currentBox = document.querySelector('#otp' + index);
		var nextBox = document.querySelector('#otp' + (index + 1));
		var ctrl = (event.key === ctrlKey || eventCode === ctrlKeyCode) ? true : false;
		var cmd = (event.key === cmdKey || eventCode === cmdKeyCode) ? true : false;

		if (ctrl || cmd || eventCode === vKeyCode) { // Already handled in paste event
			event.preventDefault();
			return;
		}

		event.preventDefault();
		eventStopPropagation(event);
		entryType = 'manual_entry ';
		if(currentBox.value) {
			var code = getSecurityCode();
			if(code.length === 6) {
				handleSubmit(entryType);
				return;
			}
		}

		// over-ride existing value on user input 0-9 only
		if(currentBox.value && ((eventCode >= 48 && eventCode <= 57) || (eventCode >= 96 && eventCode <= 105))) {
			currentBox.value = event.key;
			nextBox.focus();
			return;
		}

		if(eventCode === 8 || eventCode === 46) { // if backspace or delete
			currentBox.value = "";
			if(index !== 1) {
				previousBox.focus()
			}
			return;
		}

		if(eventCode === 37) { // left arrow
			if(index === 1) {
				currentBox.focus;
			} else {
				previousBox.focus();
			}
			return;
		}

		if(eventCode === 39 && index !== 6) { // right arrow
			nextBox.focus();
			return;
		}
		if ((eventCode !== 8 || eventCode !== 46) && index !== 6) {
			nextBox.focus();
			return;
		}
	}

	function handleInput(event) {
		var target = getEventTarget(event);
		if (target.value.length > 1) {
			login.logger.log({
				evt: 'HANDLE_INPUT',
				data: 'INPUT_PIN_GREATER_THAN_ONE',
				calEvent: true
			});
			login.logger.pushLogs();
			var tempEl = document.createElement('input');
			tempEl.setAttribute('hidden', true);
			document.body.appendChild(tempEl);
			tempEl.value = target.value;
			var pin = tempEl.value;
			for(var i = 0; i < pin.length; i++) {
				boxes[i].value = pin[i];
				if(i < 5) {
					boxes[i+1].focus();
				}
			}
			document.body.removeChild(tempEl);
			var code = getSecurityCode();
			if(code.length === 6) {
				entryType = 'auto_entry';
				setTimeout(function() {
					handleSubmit(entryType);
				}, 250);
				return;
			}
		}
	}

	function handleOnPaste(event) {
		var target = getEventTarget(event);
		var index = target.index - 1;
		var clipboardData = event.clipboardData || window.clipboardData;
		var pastedData = clipboardData.getData('Text');

		for(var i = 0; i < pastedData.length; i++) {
			if(!isValid(pastedData[i])) {
				event.preventDefault();
				return;
			}
		}
		event.preventDefault();
		var i = 0;
		while(index < boxes.length && i < pastedData.length) {
			boxes[index].value = pastedData[i];
			boxes[index].focus();
			login.logger.log({
				evt: 'HANDLE_PASTE',
				data: 'PASTE_IN_INPUT_BOXES' + i,
				calEvent: true
			});
			i++;
			index++;
		}
		login.logger.pushLogs();

		var code = getSecurityCode();
		if(code.length === 6) {
			entryType = 'auto_entry';
			setTimeout(function() {
				handleSubmit(entryType);
			}, 250);
			return;
		}
	}

	function isValid(input) {
		for(var i = 0; i < input.length; i++) {
			if(invalidChars.includes(input[i]) && !regex.test(input[i])) {
				return false
			}
		}
		return true;
	}

	function getSecurityCode() {
		var code = "";
		for(var i = 0; i < boxes.length; i++) {
			code += boxes[i].value;
		}
		return code;
	}

	function clearSecurityCode() {
        for(var i = 0; i < boxes.length; i++) {
            boxes[i].value = "";
        }
    }

	function setSecurityCode(data){
		var i = 0;
		while (i < boxes.length && i < data.length){
			boxes[i].value = data[i];
			boxes[i].focus();
			i++;
		}
	}

	function handleOtpDecline() {
		var parentDiv = document.querySelector("#verifyOtp");
		var activeContent = parentDiv.querySelector("#otpVerification");
		var otpErrorNotification = parentDiv.querySelector(".otpError");
		$(activeContent).addClass('hide');
		$(otpErrorNotification).removeClass('hide');
	}

	function handleSubmit(entryType) {
		var token = document.querySelector('#token') || {};
		var notifications = document.querySelector('.notifications');
		var formData = {};
		var inputs;
		var otpStartTime;

		var parentDiv = document.querySelector("#verifyOtp");
		inputs = parentDiv.querySelectorAll("input");

		function handleNotifications(notificationInfo) {
			$(notifications).text('');
			if (notificationInfo && notificationInfo.msg) {
				notifications.innerHTML = '<p class="notification ' +
					notificationInfo.type + '" role="alert">' + notificationInfo.msg + '</p>';
			}
		}
		function handleXhrSuccess(response) {
			clearSecurityCode();
			firstBox.focus()
			login.utils.logCPLData({startTime: otpStartTime, status:'success', flowName: 'OTP'});
			response = response || {};
			if (response.notifications) {
				handleNotifications(response.notifications);
				token.value = response._csrf;
				login.utils.hideSpinner();
			}

			if (response.disableResend && resendLink) {
				handleOtpDecline();
			}

			if (PAYPAL.unifiedLoginInlinePostMessage) {
				login.utils.sendPostMessage(response.showSuccess ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED');
				return;
			}

			if (response.showPassword) {
				if(response.otpSmsUser) {
					handleOtpDecline();
					login.utils.hideSpinner();
					return;
				}
				login.pubsub.publish('SHOW_PASSWORD');
				login.utils.hideSpinner();
			}

			if (response.isCookieDisabledRequest && response.accessToken && response.returnUrl) {
				login.logger.log({
					evt: 'OTP_LOGIN',
					data: 'PROCESS_SLR_INTERNAL_REDIRECT',
					calEvent: true
				});
				login.logger.pushLogs();
				return login.utils.handleSlrInternalRedirect(response);
			}
			login.loadResources && login.loadResources.lazyload();

			if (response.returnUrl) {
				setTimeout(function() {
					window.location.href = response.returnUrl;
				}, 1000);
			}
		}

		login.fn.updateFnSyncContext({sourceId: 'OTP_LOGIN'});
		login.fn.addFnSyncData();
		$(notifications).text('');
		for (var i = 0; i < inputs.length; i++) {
			formData[inputs[i].name] = inputs[i].value;
		}
		formData.security_code = getSecurityCode();
		otpStartTime = $('body').data('loadStartTime');
		login.logger.log({
			evt: 'entry_type',
			data: entryType,
			instrument: true
		});
		login.logger.pushLogs();
		login.utils.showSpinner();
		$.ajax({
			url: "/signin/challenge/sms/solve",
			type: 'POST',
			data: formData,
			success: handleXhrSuccess,
			fail: function() {
				login.utils.logCPLData({startTime: otpStartTime, status:'failure', flowName: 'OTP'});
				login.utils.hideSpinner();
			}
		});
	}

	function handleResend(event) {
		var target = getEventTarget(event);
		var formData = {};
		var token = document.querySelector('#token') || {};
		var challengeId = document.querySelector('[name=challengeId]') || {};
		var nonce = document.querySelector('[name=nonce]') || {};
		var otpVariant = document.querySelector('[name=otpVariant]') || {};
		var sentText = document.querySelector('.sent');
		var failedText = document.querySelector('.failed');
		var link = target.getAttribute('href');

		eventPreventDefault(event);
		removeEvent(target, 'click', handleResend);
		$(target).addClass('greyOut');
		target.removeAttribute('href');
		formData[token.name] = token.value;
		formData[challengeId.name] = challengeId.value;
		formData[nonce.name] = nonce.value;
		formData[otpVariant.name] = otpVariant.value;
		formData.isResend = 'true';

		function reAttach(resendResultEle, status) {
			setTimeout(function() {
				if(status === 'failed') {
					login.logger.log({
						evt: 'state_name',
						data: 'begin_verify_otp',
						instrument: true
					});
					login.logger.log({
						evt: 'transition_name',
						data: 'process_resend_sms',
						instrument: true
					});
					login.logger.log({
						evt: 'int_error_desc',
						data: 'process_resend_sms_max_failure'+ (otpIntegrationType ? '_'+ otpIntegrationType : ''),
						instrument: true
					});
					login.logger.pushLogs();
					handleOtpDecline();
				} else {
					$(target).removeClass('greyOut');
					$(target).removeClass('hide');
					target.setAttribute('href', link);
					if (resendResultEle) {
						$(resendResultEle).removeClass('showToast');
					}
					addEvent(resendLink, 'click', handleResend);
				}
			}, 2000);
		}

		function handleResendResponse(response) {
			firstBox.focus()
			response = response || {};
			var resendResultEle = (response.resendFailed) ? failedText : sentText;
			var status = (response.resendFailed) ? 'failed' : 'sent';
			token.value = response._csrf;
			$(target).addClass('hide');
			$(resendResultEle).addClass('showToast');
			reAttach(resendResultEle, status);
		}

		login.logger.log({
			evt: 'state_name',
			data: 'begin_verify_otp',
			instrument: true
		});
		login.logger.log({
			evt: 'transition_name',
			data: 'process_resend_sms'+ (otpIntegrationType ? '_'+ otpIntegrationType : ''),
			instrument: true
		});
		login.logger.pushLogs();

		$.ajax({
			url: link,
			type: 'POST',
			data: formData,
			success: handleResendResponse,
			fail: function() {
				reAttach();
			}
		});
	}

	function handleTryAnotherWayModal(event) {
		var tryAnotherWayModal = document.querySelector("#tryAnotherWayModal");
		if($(tryAnotherWayModal)) {
			$(tryAnotherWayModal).removeClass('hide');
			$(tryAnotherWayModal).addClass('showModal');
		}
		var close = document.querySelector(".dialog-close");
		var loginWithPassword = document.querySelector("#loginWithPasswordLink");
		var setPassword = document.querySelector("#setPasswordLink");
		var setPasswordBtn = document.querySelector(".setPasswordBtn");
		var guestCheckout = document.querySelector("#guestCheckoutLink");
		var guestCheckoutBtn = document.querySelector("#guestCheckoutBtn");
		var otpLoginElement = $('#beginOtpLogin');
		login.logger.log({
			evt: 'state_name',
			data: 'verify_auto_otp',
			instrument: true
		});
		login.logger.log({
			evt: 'transition_name',
			data: 'try_another_way',
			instrument: true
		});
		login.logger.pushLogs();

		// When the user clicks on (x), close the modal
		addEvent(close, 'click', function(e) {
			$(tryAnotherWayModal) && $(tryAnotherWayModal).addClass('hide');
			login.logger.log({
				evt: 'try_another_way',
				data: 'try_another_way_close_btn_clicked',
				instrument: true
			});
			login.logger.pushLogs();
        });
		// handle login with password btn
		addEvent(loginWithPassword, 'click', function(e) {
			var firstSection = document.querySelector('#main section[id="verifyOtp"]');
			$(firstSection) && $(firstSection).remove();
			$('#login') && $('#login').removeClass('hide');
			// If disabled then enable email pwd field
			login.otp.enableEmailPasswordField();
			if (otpLoginElement && otpLoginElement.hasClass('hidden')) {
				otpLoginElement.removeClass('hidden');
			}
			login.otp.loadChallengePage({loginPreference: 'password_login'});
			login.logger.log({
				evt: 'try_another_way',
				data: 'login_with_your_password_clicked',
				instrument: true
			});
			login.logger.pushLogs();
        });
		// handle pwd recovery
		addEvent(setPassword, 'click', function(e) {
			eventPreventDefault(event);
			login.utils.getOutboundLinksHandler(setPasswordBtn)(e);
			login.logger.log({
				evt: 'try_another_way',
				data: 'pwd_recovery_link_clicked',
				instrument: true
			});
			login.logger.pushLogs();
		});
		// handle checkout as guest btn
		addEvent(guestCheckout, 'click', function(e) {
			eventPreventDefault(event);
			login.utils.getOutboundLinksHandler(guestCheckoutBtn)(e);
			login.logger.log({
				evt: 'try_another_way',
				data: 'checkout_as_guest_clicked',
				instrument: true
			});
			login.logger.pushLogs();
        });
		// When the user clicks anywhere outside of the modal, close it
		addEvent(window, 'click', function(e) {
			if (e.target === tryAnotherWayModal) {
				$(tryAnotherWayModal) && $(tryAnotherWayModal).addClass('hide');
			}
			login.logger.log({
				evt: 'try_another_way',
				data: 'try_another_way_close_window_clicked',
				instrument: true
			});
			login.logger.pushLogs();
        });
	}

	function attachFormEvents() {
		for(var i = 0; i < boxes.length; i++) {
			boxes[i].index = i + 1;
			var securityCode = document.querySelector('#otp' + (i+1));
			addEvent(securityCode, 'focus', handleFocus);
			addEvent(securityCode, 'keyup', handleKeyUp);
			addEvent(securityCode, 'keydown', handleKeyDown);
			addEvent(securityCode, 'paste', handleOnPaste);
			addEvent(securityCode, 'input', handleInput);
		}
		addEvent(resendLink, 'click', handleResend);
		addEvent(tryAnotherWayLink, 'click', handleTryAnotherWayModal);
		var firstBox = document.querySelector('#otp1')
		addEvent(firstBox, 'click', function(e) {
			firstBox.focus();
        });

		// check if the given browser is Chrome, chrome version >=84 and Android device for OTP Autofill.
		var currentVersionMatch = navigator.userAgent.match(/Chrome\/([0-9]+)\./i);
		var isOTPAutoFillSupported = window.navigator.vendor === 'Google Inc.' && navigator.userAgent.match(/Android/i) &&
			currentVersionMatch && Number(currentVersionMatch[1]) >= 84;
		var otpAutofillEntryEnabled = $('body').data('otpAutofillEntryEnabled') === 'true';
		if (otpAutofillEntryEnabled && isOTPAutoFillSupported && window.OTPCredential) {
			var ac = new AbortController();
			var form = document.querySelector('form[name=verifyOtp]');
			addEvent(form, 'submit', function (e) {
				ac.abort();
			});
			navigator.credentials.get({
				otp: { transport: ['sms'] },
				signal: ac.signal
			}).then(otp => {
				setSecurityCode(otp.code);
				var code = getSecurityCode();
				if (code.length === 6) {
					entryType = 'autofill_entry';
					setTimeout(function () {
						handleSubmit(entryType);
					}, 250);
					return;
				}
			}).catch(err => {
				login.logger.log({
					evt: 'OTP_AUTOFILL',
					data: 'otp_autofill_failure' + (err.toString()),
					calEvent: true
				});
				login.logger.pushLogs();
			});
		}
	}

	return {
		attachFormEvents: attachFormEvents
	};
}

login.otp = (function() {
	var resourceCache = login.utils.createCache();
	var otpIntegrationType = $('body').data('otpVariant');
	var emailDom = document.querySelector('#email')
	var passwordDom = document.querySelector('#password')
	function insertNextSection(html) {
		var main = document.querySelector('#main');
		var sections = main.querySelectorAll('section') || [];
		for (var i = 0; i < sections.length; i++) {
			var notifications = sections[i].querySelector('.notifications');
			if (notifications && $(notifications).text()) {
				$(notifications).text('');
			}
			if (!$(sections[i]).hasClass('hide')) {
				$(sections[i]).addClass('hide');
			}
		}
		main.insertAdjacentHTML('afterbegin', html);
		login.footer && login.footer();
		if(login.countryList && login.countryList.getCache('countryList')) {
			login.countryList.showCountryDropDown();
		}
	}

	function handleNotifications(notificationInfo) {
		var notifications = document.querySelector('.notifications');
		$(notifications).text('');
		if (notificationInfo && notificationInfo.msg) {
			notifications.innerHTML = '<p class="notification ' +
				notificationInfo.type + '" role="alert">' + notificationInfo.msg + '</p>';
		}
	}

	function handleNotYou(details) {
		var notYouLink = document.querySelector('.otpDisplayCredentials a');
		if (notYouLink) {
			addEvent(notYouLink, 'click', function(event) {
				eventPreventDefault(event);
				login.utils.notYouClickHandlerForCookiedUser(event, function() {
					login.utils.showSpinner({ nonTransparentMask: true });
					login.logger.log({
						evt: 'state_name',
						data: 'begin_' + details.stateName,
						instrument: true
					});
					login.logger.log({
						evt: 'transition_name',
						data: 'click_not_you' + (otpIntegrationType ? '_'+ otpIntegrationType : ''),
						instrument: true
					});
					login.logger.pushLogs();
				})
			});
		}
	}

	function handleSignup() {
		var signupContainer = document.querySelector('.otpLoginPrimary #signupContainer');
		var signupBtn = document.querySelector('.otpLoginPrimary #createAccount');
		var signupLink = signupBtn && signupBtn.getAttribute('href');

		if (!signupContainer) {
			return;
		}
		if (signupLink) {
			addEvent(signupBtn, 'click', function(event) {
				eventPreventDefault(event);
				login.logger.log({
					evt: 'state_name',
					data: 'begin_otp',
					instrument: true
				});
				login.logger.log({
					evt: 'transition_name',
					data: 'process_onboarding',
					instrument: true
				});
				login.logger.pushLogs();
				window.location.href = signupLink;
			});
		}
	}

	function handlePwr() {
		var pwrRecoveryContainer = document.querySelector('.otpLoginPrimary #forgotPasswordModal');
		var pwrLink = pwrRecoveryContainer && pwrRecoveryContainer.getAttribute('href');

		if (!pwrRecoveryContainer) {
			return;
		}
		if (pwrLink) {
			addEvent(pwrRecoveryContainer, 'click', function(event) {
				eventPreventDefault(event);
				login.logger.log({
					evt: 'state_name',
					data: 'begin_otp',
					instrument: true
				});
				login.logger.log({
					evt: 'transition_name',
					data: 'process_setup_pwd',
					instrument: true
				});
				login.logger.pushLogs();
				window.location.href = pwrLink;
			});
		}
	}

	// if auto sms then attach events
	function handleAutoSms() {
		var inputs = document.querySelectorAll('input') || [];
		var formData = {};

		for (var i = 0; i < inputs.length; i++) {
			formData[inputs[i].name] = inputs[i].value;
		}
		var isOtpNewExp = formData.otpNewExp;
		if (document.querySelector('#verifyOtp') && formData.autoSmsSent) {
			if (isOtpNewExp){
				verifyOtpPrimary(otpIntegrationType).attachFormEvents();
			} else {
				verifyOtp().attachFormEvents();
			}
			handleSecondaryLinkClick({stateName: 'verify_auto_otp'});
			login.logger.log({
				evt: 'state_name',
				data: 'verify_auto_otp',
				instrument: true
			});
			login.logger.log({
				evt: 'transition_name',
				data: 'prepare_verify_auto_otp' + (otpIntegrationType ? '_'+ otpIntegrationType : ''),
				instrument: true
			});
			login.logger.pushLogs();
			var firstBox = document.querySelector('#otp1');
			firstBox.click();
		}
	}

	function sendSms(event) {
		var target = getEventTarget(event);
		var inputs = target.querySelectorAll('input') || [];
		var token = document.querySelector('#token') || {};
		var selectedPhoneChallengeDropDown = document.querySelector('.selectPhoneChallenges select');
		var formData = {};
		eventPreventDefault(event);

		for (var i = 0; i < inputs.length; i++) {
			formData[inputs[i].name] = inputs[i].value;
		}
		var isOtpNewExp = formData.otpNewExp;
		if (selectedPhoneChallengeDropDown) {
			var selectedChallenge = selectedPhoneChallengeDropDown.options[selectedPhoneChallengeDropDown.selectedIndex];
			formData.challengeId = selectedChallenge.value;
			formData.maskedPhoneNumber = $(selectedChallenge).text();
		}

		function handleXhrSuccess(response) {
			response = response || {};
			if (response.notifications) {
				handleNotifications(response.notifications);
				token.value = response._csrf;
				login.utils.hideSpinner();
			}

			if (response.html) {
				insertNextSection(response.html);
			}
			if (document.querySelector('#verifyOtp')) {
				$('#otpLogin').remove();
				if (isOtpNewExp){
					verifyOtpPrimary(otpIntegrationType).attachFormEvents();
				} else {
					verifyOtp().attachFormEvents();
				}
				handleSecondaryLinkClick({stateName: 'verify_otp'});
				login.logger.log({
					evt: 'state_name',
					data: 'begin_verify_otp',
					instrument: true
				});
				login.logger.log({
					evt: 'transition_name',
					data: 'prepare_verify_otp' + (otpIntegrationType ? '_'+ otpIntegrationType : ''),
					instrument: true
				});
				login.logger.pushLogs();
			}
			login.utils.hideSpinner();

			var firstBox = document.querySelector('#otp1');
			firstBox.click();
		}

		login.utils.showSpinner();
		$.ajax({
			url: target.getAttribute('action'),
			type: 'POST',
			data: formData,
			success: handleXhrSuccess,
			fail: function() {
				login.utils.hideSpinner();
			}
		});
	}

	// If disabled in safari to avoid keychain auto suggest in OTP page, enable it on landing back on email password page
	function enableEmailPasswordField() {
		if(emailDom.hasAttribute('disabled')) {
			emailDom.removeAttribute('disabled');
		}
		if(passwordDom.hasAttribute('disabled')) {
			passwordDom.removeAttribute('disabled');
		}
	}
	function showPassword() {
		var firstSection = document.querySelector('#main section');
		$(firstSection).remove();

		enableEmailPasswordField();
		$('#login').removeClass('hide');
		loadChallengePage({loginPreference: 'password_login'});
	}

	function handleSecondaryLinkClick(details) {
		var secondaryLink = document.querySelector('.secondaryLink a');
		var otpVariantElement = document.querySelector('form[name=sendOtp] input[name=otpVariant]') ||
			document.querySelector('form[name=verifyOtp] input[name=otpVariant]');
		var emailField = document.querySelector('form[name=sendOtp] input[name=email]') ||
			document.querySelector('form[name=verifyOtp] input[name=email]');
		var otpLoginElement = $('#beginOtpLogin');
		addEvent(secondaryLink, 'click', function() {
			eventPreventDefault(event);
			if (PAYPAL.unifiedLoginInlinePostMessage) {
				login.utils.sendPostMessage('NOT_NOW');
				return;
			}
			if (otpVariantElement && otpVariantElement.value === 'onOnboardingFlow' && emailField && emailField.value) {
				login.utils.showSpinner();
				login.utils.submitPublicCredential(emailField.value);
			} else {
				showPassword();
			}
			if (otpLoginElement && otpLoginElement.hasClass('hidden')) {
				otpLoginElement.removeClass('hidden');
			}
			login.logger.log({
				evt: 'state_name',
				data: 'begin_' + details.stateName,
				instrument: true
			});
			login.logger.log({
				evt: 'transition_name',
				data: 'click_login_another_way',
				instrument: true
			});
			login.logger.pushLogs();
		});
	}

	function handlePhoneChallengesSelection(event) {
		var selectPhoneChallengeSpan = document.querySelector('.selectedPhoneChallenge span');
		var dropDown = getEventTarget(event);
		var selectedOptionText = $(dropDown.options[dropDown.selectedIndex]).text();
		login.logger.log({
			evt: 'state_name',
			data: 'begin_verify_otp',
			instrument: true
		});
		login.logger.log({
			evt: 'transition_name',
			data: 'existing_linked_number_changed',
			instrument: true
		});
		login.logger.pushLogs();
		$(selectPhoneChallengeSpan).text(selectedOptionText);
	}

	function attachFormEvent() {
		var otpLoginForm = document.querySelector('#otpLogin .proceed');
		var phoneChallengesSelect = document.querySelector('.selectPhoneChallenges select');

		if (otpLoginForm) {
			addEvent(otpLoginForm, 'submit', sendSms);
		}

		handleAutoSms();
		handleSecondaryLinkClick({stateName: 'otp_interstitial'});
		handleNotYou({stateName: 'verify_otp'});
		handleSignup();
		handlePwr();
		login.pubsub.subscribe('SHOW_PASSWORD', showPassword);

		if (phoneChallengesSelect) {
			addEvent(phoneChallengesSelect, 'change', handlePhoneChallengesSelection);
		}
	};

	function renderPage(page) {
		insertNextSection(page);
		attachFormEvent();
		login.logger.log({
			evt: 'state_name',
			data: 'begin_otp_interstitial',
			instrument: true
		});
		login.logger.log({
			evt: 'transition_name',
			data: 'otp_interstitial'+ (otpIntegrationType ? '_'+ otpIntegrationType : ''),
			instrument: true
		});
		login.logger.pushLogs();
	}

	function showOnPwdPage() {
		var otpLoginElement = document.querySelector('#beginOtpLogin a') || document.querySelector('#beginOtpLogin button');
		var otpLoginElementContainer = otpLoginElement && $(otpLoginElement.parentNode);
		var tryAnotherWay = document.querySelector('#loginWithOtp');
		var integrationType = $('body').data('otpLoginIntegrationType') || '';

		login.utils.hideSpinner();
		if (!otpLoginElement || !otpLoginElementContainer) {
			return;
		}

		addEvent(otpLoginElement, 'click', function(event) {
			eventPreventDefault(event);
			login.logger.log({
				evt: 'state_name',
				data: 'begin_pwd',
				instrument: true
			});
			login.logger.log({
				evt: 'transition_name',
				data: 'click_otp_login' + (otpIntegrationType ? '_'+ otpIntegrationType : ''),
				instrument: true
			});
			login.logger.log({
				evt: 'OTP_LOGIN',
				data: 'CLICK_VIA_LINK',
				calEvent: true
			});
			login.logger.pushLogs();
			if (resourceCache.get('sendSmsChallengePage')) {
				renderPage(resourceCache.get('sendSmsChallengePage'));
				if(!emailDom.hasAttribute('disabled')) {
					emailDom.setAttribute('disabled', 'disabled');
				}
				if(!passwordDom.hasAttribute('disabled')) {
					passwordDom.setAttribute('disabled', 'disabled');
				}
			}
			loadChallengePage({loginPreference: 'otp_login'});
		});

		if (integrationType === 'via_link') {
			otpLoginElementContainer.removeClass('notVisible');
			return;
		}
		if (integrationType === 'via_button') {
			otpLoginElementContainer.removeClass('hidden');
		}

		if (tryAnotherWay && tryAnotherWay.classList) {
			tryAnotherWay.classList.remove('hide');
		}
	}

	function loadChallengePage(data) {
		var loginForm = document.querySelector('.proceed');
		var inputs = loginForm.querySelectorAll('input') || [];
		var token = document.querySelector('#token') || {};
		var isCacheXhrSuccessResponse = data.integrationType === 'viaLink' ||
			data.integrationType ==='autoSendOtp' || data.integrationType ==='secondaryOtp' || data.integrationType ==='onOnboardingFlow';
		var formData = {};
		var phoneCodeDom = document.querySelector('#phoneCode');
		var otpLoginElement = document.querySelector('#beginOtpLogin');
		var otpSmsUser = $('body').data('otpSmsUser');

		for (var i = 0; i < inputs.length; i++) {
			formData[inputs[i].name] = inputs[i].value;
		}

		if (formData.login_phone && phoneCodeDom) {
			formData.phoneCode = phoneCodeDom.value;
		}

		formData.otpVariant = data.integrationType;
		formData.loginPreference = data.loginPreference;

		function cacheXhrSuccessResponse(response) {
			login.logger.log({
				evt: 'CHALLENGE_SMS_SUCCESS',
				data: 'CHALLENGE_SMS_SUCCESS',
				calEvent: true
			});
			login.logger.log({
				evt: 'state_name',
				data: 'otp_cs_eligibility',
				instrument: true
			});
			login.logger.log({
				evt: 'transition_name',
				data: 'process_otp_cs_eligibility',
				instrument: true
			});
			if (!otpSmsUser && (!data.otpLoginEligible || !otpLoginElement)) {
				enableEmailPasswordField();
				login.logger.log({
					evt: 'CHALLENGE_SMS_SUCCESS',
					data: 'OTP_LOGIN_INELIGIBLE',
					calEvent: true
				});
				login.logger.log({
					evt: 'int_error_code',
					data: 'opt_login_ineligible_sms',
					instrument: true
				});
				login.logger.pushLogs();
				login.utils.hideSpinner();
				return;
			}

			if (response && response.html) {
				if(data.integrationType === 'autoSendOtp' || data.integrationType === 'onOnboardingFlow'){
					resourceCache.update({sendSmsChallengePage: response.html});
					renderPage(response.html);
				}
				showOnPwdPage();
				login.logger.log({
					evt: 'source_decisioning',
					data: 'otp_login_via_link_shown',
					instrument: true
				});
				login.logger.log({
					evt: 'int_error_code',
					data: 'opt_login_ineligible_html',
					instrument: true
				});
				login.logger.pushLogs();
				resourceCache.update({sendSmsChallengePage: response.html});
				return;
			}
			enableEmailPasswordField();
			login.logger.pushLogs();
			login.utils.hideSpinner();
		}

		function handleXhrSuccess(response) {
			login.logger.log({
				evt: 'CHALLENGE_SMS_HANDLE_XHR',
				data: 'CHALLENGE_SMS_HANDLE_XHR',
				calEvent: true
			});
			login.logger.log({
				evt: 'state_name',
				data: 'otp_cs_eligibility',
				instrument: true
			});
			login.logger.log({
				evt: 'transition_name',
				data: 'process_otp_cs_eligibility',
				instrument: true
			});
			if (!data.otpLoginEligible && !otpSmsUser) {
				login.logger.log({
					evt: 'CHALLENGE_SMS_HANDLE_XHR',
					data: 'OTP_LOGIN_INELIGIBLE',
					calEvent: true
				});
				login.logger.log({
					evt: 'int_error_code',
					data: 'opt_login_ineligible_handle_xhr',
					instrument: true
				});
				login.logger.pushLogs();
				login.utils.hideSpinner();
				return;
			}

			if (response.notifications) {
				handleNotifications(response.notifications);
				token.value = response._csrf;
				login.logger.log({
					evt: 'CHALLENGE_SMS_HANDLE_XHR',
					data: 'NOTIFICATIONS',
					calEvent: true
				});
				login.logger.log({
					evt: 'int_error_code',
					data: 'opt_login_notifications',
					instrument: true
				});
				login.logger.pushLogs();
				login.utils.hideSpinner();
				return;
			}

			if (response.html) {
				login.logger.log({
					evt: 'CHALLENGE_SMS_HANDLE_XHR',
					data: 'HTML',
					calEvent: true
				});
				login.logger.log({
					evt: 'int_error_code',
					data: 'opt_login_html',
					instrument: true
				});
				renderPage(response.html);
			}
			login.logger.pushLogs();
			login.utils.hideSpinner();
		}

		(!isCacheXhrSuccessResponse && !data.loginPreference) && login.utils.showSpinner();

		$.ajax({
			url: '/signin/challenge/sms',
			type: 'POST',
			data: formData,
			success: function(response) {
				response = response || {};
				if(response.loginPreferenceUpdated) {
					login.utils.hideSpinner();
					return;
				}
				isCacheXhrSuccessResponse ? cacheXhrSuccessResponse(response) : handleXhrSuccess(response);
			},
			fail: function() {
				login.logger.log({
					evt: 'CHALLENGE_SMS_FAILURE',
					data: 'CHALLENGE_SMS_FAILURE',
					calEvent: true
				});
				login.logger.log({
					evt: 'state_name',
					data: 'otp_cs_eligibility',
					instrument: true
				});
				login.logger.log({
					evt: 'transition_name',
					data: 'process_otp_cs_eligibility',
					instrument: true
				});
				login.logger.log({
					evt: 'int_error_code',
					data: 'challenge_sms_failure',
					instrument: true
				});
				login.logger.pushLogs();
				!isCacheXhrSuccessResponse && login.utils.hideSpinner();
			}
		});
	}
	function handleAutoSend(data){
		// need new instrumentation keys here
		var isUserDeviceTokenLoginEligible = $('body').data('userDeviceTokenLogin');
		var ulData = window.PAYPAL.ulData || {};
		var aPayAuth = ulData.aPayAuth;
		var oneTouchUser = $('body').data('oneTouchUser');
		var otpSmsUser = $('body').data('otpSmsUser');
		login.logger.log({
			evt: 'HANDLE_AUTO_SEND',
			data: 'HANDLE_AUTO_SEND',
			calEvent: true
		});
		if (data.otpVariant=== 'autoSendOtp') {
			loadChallengePage({integrationType: data.otpVariant, otpLoginEligible: data.otpLoginEligible});
		}
		if ( $('body').data('otpVariant') !== 'autoSendOtp' && !otpSmsUser) {
			login.logger.log({
				evt: 'HANDLE_AUTO_SEND',
				data: 'NOT_AUTO_OTP',
				calEvent: true
			});
			login.logger.pushLogs();
			return;
		}
		if ( $('body').data('otpVariant') === 'autoSendOtp' && (aPayAuth || isUserDeviceTokenLoginEligible || oneTouchUser)) {
			login.logger.log({
				evt: 'HANDLE_AUTO_SEND',
				data: (aPayAuth || isUserDeviceTokenLoginEligible || oneTouchUser) ? 'PASSWORDLESS_LOGIN': '',
				calEvent: true
			});
			login.logger.pushLogs();
			return;
		}
		login.logger.pushLogs();
		loadChallengePage({integrationType: $('body').data('otpVariant'), otpLoginEligible: $('body').data('otpLoginEligible')});
	}
	function handleOnPasswordFailure(data) {
		var startOtpLogin = document.querySelector('.startOtpLogin');
		addEvent(startOtpLogin, 'click', function(event) {
			eventPreventDefault(event);
			login.logger.log({
				evt: 'state_name',
				data: 'begin_pwd',
				instrument: true
			});
			login.logger.log({
				evt: 'transition_name',
				data: 'click_otp_link',
				instrument: true
			});
			login.logger.pushLogs();
			loadChallengePage({integrationType: 'onPasswordFailure', otpLoginEligible: $('body').data('otpLoginEligible') || data.otpLoginEligible});
		});
	}

	function handleOnOnboardingFlow(data) {
		// need new instrumentation keys here
		if (data.integrationType !== 'onOnboardingFlow') {
			return;
		}
		loadChallengePage({integrationType: data.integrationType, otpLoginEligible: $('body').data('otpLoginEligible') || data.otpLoginEligible});
	}

	function handleOnTryAnotherWayModal(data) {
		// need new instrumentation keys here
		if (data.integrationType !== 'onTryAnotherWayModal') {
			return;
		}
		loadChallengePage({integrationType: data.integrationType, otpLoginEligible: $('body').data('otpLoginEligible') || data.otpLoginEligible});
	}

	function handleOnPwdPage(data) {
		var otpLoginElement = $('#beginOtpLogin');
		if (!data) {
			return;
		}
		if (!data.otpLoginOnPwdPageEnabled && otpLoginElement && otpLoginElement.hasClass('otpLoginViaLink') &&
			!otpLoginElement.hasClass('notVisible')) {
			otpLoginElement.addClass('notVisible');
		}
		if (!data.otpLoginOnPwdPageEnabled && otpLoginElement && otpLoginElement.hasClass('otpLoginViaButton') &&
			!otpLoginElement.hasClass('hidden') && !login.otp.hideOnboardingModal) {
			otpLoginElement.addClass('hidden');
		}

		if (!Object.keys(data).length && $('body').data('otpLoginOnPwdPageEnabled') && $('body').data('otpVariant') !== 'autoSendOtp') {
			otpIntegrationType = $('body').data('otpVariant') ? $('body').data('otpVariant') : 'viaLink';
			setTimeout(loadChallengePage.bind(null, {integrationType: otpIntegrationType, otpLoginEligible: $('body').data('otpLoginEligible')}), 50);
		}

		if (data.otpLoginOnPwdPageEnabled && data.otpVariant !== 'autoSendOtp') {
			otpIntegrationType =  data.otpVariant ?  data.otpVariant: 'viaLink';
			setTimeout(loadChallengePage.bind(null, {integrationType: otpIntegrationType, otpLoginEligible: data.otpLoginEligible}), 500);
		}
	}

	function handleLeadOnPublicCredential(data) {
		var isSafari = $('body').data('loginExperience') === 'safari';
		var otpSmsUser = data.otpSmsUser;
		// isSafariAutofill only detect uncookied user who prefilled password on email page
		var autofilledPasswordField = login.utils.isFieldPrefilled(document.querySelector('#password'));
		var isSafariAutofill = isSafari && autofilledPasswordField;
		var otpIntegrationType = $('body').data('otpVariant');
		if (data.otpInterstitialHtml && ((!login.utils.isSiAppleActivationProcessing() && !isSafariAutofill) || otpSmsUser)) {
			resourceCache.update({sendSmsChallengePage: data.otpInterstitialHtml});
			if(!login.otp.hideOnboardingModal) {
				otpIntegrationType = 'autoSendOtp';
				renderPage(data.otpInterstitialHtml);
			}
			showOnPwdPage();
		}
		if(data.otpInterstitialHtml && isSafariAutofill) {
			var otpLoginElement = $('#beginOtpLogin');
			if (otpLoginElement && otpLoginElement.hasClass('hidden')) {
				otpLoginElement.removeClass('hidden');
			}
			login.logger.log({
				evt: 'autofilled_credentials',
				data: 'Y',
				instrument: true
			});
			login.logger.pushLogs();
			otpIntegrationType ='secondaryOtp';
			setTimeout(loadChallengePage.bind(null, {integrationType: otpIntegrationType, otpLoginEligible: true}), 50);
		}
	}

	function clearContext() {
		var otpLoginElement = $('#beginOtpLogin');
		if (!otpLoginElement) {
			return;
		}

		if (otpLoginElement.hasClass('otpLoginViaLink') && !otpLoginElement.hasClass('notVisible')) {
			otpLoginElement.addClass('notVisible');
		}
		if (otpLoginElement.hasClass('otpLoginViaButton') && !otpLoginElement.hasClass('hidden')) {
			otpLoginElement.addClass('hidden');
		}
		resourceCache.clear('sendSmsChallengePage');
	}

	return {
		prepareSendPage: function (data) {
			data = data || {};
			handleOnPasswordFailure(data);
			handleOnOnboardingFlow(data);
			handleOnTryAnotherWayModal(data);
			handleAutoSend(data);
			handleOnPwdPage(data);
			handleLeadOnPublicCredential(data);
			login.pubsub.subscribe('CLEAR_OTP_LOGIN_CONTEXT', clearContext);
		},
		attachSendPageEvents: attachFormEvent,
		enableEmailPasswordField: enableEmailPasswordField,
		loadChallengePage: loadChallengePage
	};
}());

function loadFeatures() {
	if ($('body').data('qrCodeFeatureEnabled')) {
		login.qrCode.initialize();
	}
	login.core();
	if (login.jwt) {
		login.jwt();
	}
	if (login.oneTouchLogin) {
		login.oneTouchLogin();
	}
	if (login.singleSignOn) {
		login.singleSignOn();
	}
	if (login.webAuthn) {
		var partyIdHash = $('body').data('partyIdHash');
		var webAuthnLoginCtx = $('body').data('webAuthnLoginContext');
		if(partyIdHash && webAuthnLoginCtx) {
			login.webAuthn.attachFormEvent();
		}
		login.webAuthn.setContext();
	}
	if (login.otp) {
		login.otp.prepareSendPage();
	}
	if (login.onboardingFlow) {
		login.onboardingFlow.prepareLandingPage();
	}
	if (login.noAccExists) {
		login.noAccExists.attachFormEvent();
	}
	if (login.ssoInterstitial) {
		login.ssoInterstitial.attachFormEvent();
	}
	login.oneTouch();
	login.footer();
	login.pwr();
	login.ads.init();

	if (login.siapple) {
		var appleIdpJsonDOM = document.querySelector('input[name="appleIdpJson"]');
		var appleIdpJson = appleIdpJsonDOM && appleIdpJsonDOM.value;
		login.siapple({ appleIdpJson: appleIdpJson });
	}
	if (login.keychain) {
		login.keychain();
	}

	if (login.smartLock) {
		login.smartLock();
	}
	if (login.tpdLogin) {
		login.tpdLogin.initialize();
	}
	if (login.geoEnablement) {
		login.geoEnablement.setGeoMessage();
	}
	login.showHidePassword();
}

// 1. Load fraudnet & incontextXO first always
// 2. Check for an autoTrigger login priority e.g. UDT implicit
// - If autoTrigger fails, fallback to the default feature load
// - If login priority not enabled, load features as usual.
login.bootstrap = function() {
	login.fn.initialize();
	if (login.checkoutIncontext) {
		login.checkoutIncontext();
	}

	var autoTriggerLoginPriority = $('body').data('autoTriggerLoginPriority');
	var autoTriggerLoginPriorityHandler = login[autoTriggerLoginPriority];
	if (autoTriggerLoginPriorityHandler) {
		return autoTriggerLoginPriorityHandler(function onNext() {
			return loadFeatures();
		});
	}

	return loadFeatures();
};

/**
* Log the preload assets information to fpti
*/
function logPreloadAssetsDownloadData() {
	var ulData = (window.PAYPAL && window.PAYPAL.ulData) || {};
	if(ulData) {
		var totalAssetsCount = (!ulData.preloadScriptUrl) ?  0 : ulData.preloadScriptUrl.split(',').length;
		var totalAssetsDownloaded  = ulData.preloadScriptDownloadLength || 0;
		login.logger.log({evt: 'preload_total_assets', data: totalAssetsCount, instrument: true});
		login.logger.log({evt: 'preload_downloaded_assets', data: totalAssetsDownloaded, instrument: true});
		login.logger.pushLogs();
	}
}

/**
 * Integrating apps can provide their client side scripts to preload on login render
 * This method provisions to load them via XHR requests
 *
 * @param {String} urls
 */
function asyncLoadAssetUrls(urls) {
	// attach event to log the download stats
	var enableLogPreloadAssetsDownloadData = $('body').data('enableLogPreloadAssetsDownloadData');
	enableLogPreloadAssetsDownloadData && addEvent(window, 'beforeunload', logPreloadAssetsDownloadData);
	var assetUrlList = urls.split(',');
	var assetUrl;
	var assetUrlArray;
	var extensionArray = ['js', 'css'];
	for (var i = 0; i < assetUrlList.length; i++) {
		assetUrl = assetUrlList[i];
		assetUrlArray = assetUrl.split('.');
		// Ensure the script url is fully qualified secure domain javascript and css url
		if (assetUrl && assetUrl.slice(0, 8) === 'https://'
			&& (extensionArray.includes(assetUrlArray[assetUrlArray.length - 1]))) {
			try{
				var req = window.XMLHttpRequest ? new XMLHttpRequest() : new ActiveXObject('Microsoft.XMLHTTP');
				addEvent(req, 'load', function() {
					PAYPAL.ulData.preloadScriptDownloadLength++;
				});
				req.open('GET', assetUrlList[i]);
				req.send(); // This line is just to fetch the file and not intent to parse
			} catch (e) {
				// do nothing
			}
		}
	}
}

/**
 * Shows return to merchant link if DOM element present and view rendered in a full page.
 */
function showReturnToMerchantLink() {
	var return2MerchantLink = document.querySelector('#returnToMerchant');
	var container = document.querySelector('.contentContainer');
	// DOM element will only be present on third party login flow
	// link will not be shown if page is pop up/mini browser
	if (return2MerchantLink && !window.opener) {
		// Full page case
		$(return2MerchantLink).removeClass('hide');
		if (container)	{
			// make container shorter and show link
			$(container).addClass('contentContainerShort');
		}
	}
}

function trackHybridLoginRenderedEventInCal() {
	var isCheckout = login.utils.getIntent() === 'checkout';
	var deviceType = $('body').hasClass('mobile') ? 'MOBILE' : 'DESKTOP';
	if (login.utils.isHybridLoginExperience()) {
		// TODO Handle different intents, not just XO and non-XO use cases.
		login.logger.log({
			evt: 'HYBRID_LOGIN',
			data: 'RENDERED' + (isCheckout ? '_XO' : '') + '_' + deviceType,
			calEvent: true
		});
	}
}

/**
 * Initial instrumentation specifically for non-split UL as Landing login for Checkout
 */
function instrumentUlAsLandingPageLoad() {
	var passwordField = document.querySelector('#password');
	var isPasswordAutofilled;
	var currentLang = document.querySelector('input[name="locale.x"]');
	var clientLogRecords = document.querySelector('input[name="clientLogRecords"]');

	if (passwordField) {
		isPasswordAutofilled = login.utils.isFieldPrefilled(passwordField) ||
			passwordField.value.length > 0;
	}

	var oneTouchUser = $('body').data('oneTouchUser');
	var ulData = (window.PAYPAL && window.PAYPAL.ulData) || {};
	var aPayAuth = ulData.aPayAuth;

	// Skip the page load level client logging in case of One Touch / A-Pay login eligible request
	if (oneTouchUser || aPayAuth) {
		return;
	}

	// Log the base level metrics prepared from server side
	login.logger.logServerPreparedMetrics();

	if (!clientLogRecords) {
		login.logger.log({
			evt: 'state_name',
			data: login.utils.getKmliCb() ? 'LOGIN_UL_RM' : 'LOGIN_UL',
			instrument: true
		});

		login.logger.log({
			evt: 'transition_name',
			data: 'prepare_login_ul',
			instrument: true
		});
	}

	login.logger.log({
		evt: 'landing_page',
		data: 'login',
		instrument: true
	});

	login.logger.log({
		evt: 'is_pwd_autofill',
		data: isPasswordAutofilled ? 'Y' : 'N',
		instrument: true
	});

	login.logger.log({
		evt: 'design',
		data: login.utils.isInContextIntegration() ? 'in-context' : 'full-context',
		instrument: true
	});

	if (currentLang) {
		login.logger.log({
			evt: 'page_lang',
			data: currentLang.value,
			instrument: true
		});
	}

	login.logger.pushLogs();
}

function instrumentSplitLoginPageLoad(splitLoginContext) {
	var stateName = 'begin_email';
	var transitionName = 'prepare_email';
	var autofilledField = login.utils.isFieldPrefilled(document.querySelector('#email'));
	var currentLang = document.querySelector('input[name="locale.x"]');
	var slAction = window.PAYPAL && window.PAYPAL.slData && window.PAYPAL.slData.slAction;
	var oneTouchUser = $('body').data('oneTouchUser');
	var ulData = (window.PAYPAL && window.PAYPAL.ulData) || {};
	var aPayAuth = ulData.aPayAuth;
	var moreOptionsContainer = document.querySelector('#moreOptionsContainer');
	var ssoLogin = $('body').data('ssoviatoken');
	var isHybrid = login.utils.isHybridLoginExperience();
	var forgotEmailLink = document.querySelector('#forgotEmail');
	var forgotPasswordLink = document.querySelector('#forgotPassword');

	addEvent(forgotEmailLink, 'click', function() {
		login.logger.log({
			evt: 'state_name',
			data: stateName,
			instrument: true
		});

		login.logger.log({
			evt: 'transition_name',
			data: 'forgot_public_credential',
			instrument: true
		});

		login.logger.pushLogs();
	});

	addEvent(forgotPasswordLink, 'click', function() {
		login.logger.log({
			evt: 'state_name',
			data: stateName,
			instrument: true
		});

		login.logger.log({
			evt: 'transition_name',
			data: 'forgot_private_credential',
			instrument: true
		});

		login.logger.pushLogs();
	});

	// Skip the page load level client logging in case of One Touch / A-Pay login eligible request
	// Skip the logging if ssoLogin usecase
	if (oneTouchUser || aPayAuth || ssoLogin) {
		return;
	}

	// slActivation page will be rendered, hence the state and transition will be logged in smartlock handler
	// Post login slOptIn page rendered, we dont want to log input password in case of post login optIn
	if (slAction === 'activation' || slAction === 'optIn') {
		return;
	}

	if (isHybrid) {
		stateName = 'begin_hybrid_login';
		transitionName = 'prepare_hybrid'
	}

	if (splitLoginContext === 'inputPassword') {
		stateName = isHybrid ? 'begin_hybrid_pwd' : 'begin_pwd';
		transitionName = isHybrid ? 'prepare_hybrid_pwd' : 'prepare_pwd';
		transitionName += login.utils.getKmliCb() ? '_ot' : '';
		autofilledField = login.utils.isFieldPrefilled(document.querySelector('#password'));
	}

	if (splitLoginContext === 'inputPhone') {
		stateName = 'begin_phone';
		transitionName = 'prepare_phone';
	}

	// We call it only for uncookied hybrid. Cookied goes directly to the password page.
	if (splitLoginContext === 'inputEmail') {
		trackHybridLoginRenderedEventInCal();
	}

	if (moreOptionsContainer && !$(moreOptionsContainer).hasClass('hide') && splitLoginContext === 'inputPassword') {
		transitionName = transitionName + '_more_opt';
		login.logger.log({
			evt: 'exp_shown',
			data: 'tpd',
			instrument: true
		});
	}

	if (splitLoginContext === 'inputPassword') {
		var phoneField = document.querySelector('#phone');
		login.logger.log({
			evt: 'pub_cred_type',
			data: (phoneField && phoneField.value) ? 'phone' : 'email',
			instrument: true
		});
	}

	login.logger.log({
		evt: 'state_name',
		data: stateName,
		instrument: true
	});

	login.logger.log({
		evt: 'transition_name',
		data: transitionName,
		instrument: true
	});

	login.logger.log({
		evt: 'autofill',
		data: autofilledField ? 'Y' : 'N',
		instrument: true
	});

	if (login.utils.getIntent() === 'checkout') {
		login.logger.log({
			evt: 'landing_page',
			data: 'login',
			instrument: true
		});

		login.logger.log({
			evt: 'design',
			data: login.utils.isInContextIntegration() ? 'in-context' : 'full-context',
			instrument: true
		});
	}

	if (currentLang) {
		login.logger.log({
			evt: 'page_lang',
			data: currentLang.value,
			instrument: true
		});
	}
	login.logger.pushLogs();
}

function instrumentProx() {
	var returnToMerchantLink = document.querySelector('.cancelUrl');
	var cancelAndReturnEvtHandler;

	if (login.utils.isPpFrameMiniBrowser()) {
		login.utils.postPpBridgeMessage({
			flowtype: 'prox',
			status: 'loading',
			viewname: 'login'
		});

		login.utils.postPpBridgeMessage({
			flowtype: 'prox',
			status: 'complete',
			viewname: 'login'
		});

		login.utils.postPpBridgeMessage({
			operation: 'init',
			cancelUrl: $('body').data('returnUrl') || '',
			landingUrl: window.location.href,
			secureWindowMsg: $('body').data('secureWindowMsg') || '',
			processingMsg: $('body').data('processingMsg') || ''
		});

		addEvent(window, 'beforeunload', function(e) {
			var target = getEventTarget(e);
			var activeElement = target && target.activeElement && target.activeElement.nodeName;
			if (activeElement === 'BODY') {
				login.utils.postPpBridgeMessage({
					flowtype: 'prox',
					status: 'exit',
					viewname: 'login',
					exit_type: 'user_cancelled'
				});
			}
		});

		// Remove return to merchant link in case of Mini Browser
		$(returnToMerchantLink).remove();
	} else {
		// Provision instrumentation for outbound cancel & return to merchant link
		cancelAndReturnEvtHandler = login.utils.getOutboundLinksHandler(returnToMerchantLink, 'login_ul',
			'process_cancel_and_return_to_merchant');

		login.pubsub.subscribe('WINDOW_CLICK', function(e) {
			var target = getEventTarget(e);
			if (target && $(target).hasClass('cancelLink')) {
				cancelAndReturnEvtHandler.call(null, e);
			}
		});
	}

	login.logger.log({
		evt: 'state_name',
		data: 'login_ul',
		instrument: true
	});

	login.logger.log({
		evt: 'transition_name',
		data: 'prepare_login_ul',
		instrument: true
	});

	login.logger.pushLogs();

}

function autoLoginfallBackClientLog(options) {
	var splitLoginContext = login.utils.getSplitLoginContext();
	var ulData = window.PAYPAL.ulData || {};

	options = options || {};
	// Remove both OT and aPay related context from the client
	document.querySelector('body').removeAttribute('data-one-touch-user');
	ulData.aPayAuth = null;

	// Log the exit error code when displaying login for failure case
	if (options.error_code) {
		login.logger.log({
			evt: 'ext_error_code',
			data: options.error_code,
			instrument: true
		});
	}

	// Invoke the default page load client logger method
	if (splitLoginContext) {
		instrumentSplitLoginPageLoad(splitLoginContext);
		return;
	}
	// Fallback logging
	instrumentUlAsLandingPageLoad();
}

// Private method to check the browser level Payment Request and Android pay supported or not
function isAPaySupported() {
	var currentVersionMatch = navigator.userAgent.match(/Chrome\/([0-9]+)\./i);
	return window.navigator.vendor === 'Google Inc.' &&
		'PaymentRequest' in window &&
		navigator.userAgent.match(/Android/i) &&
		currentVersionMatch &&
		Number(currentVersionMatch[1]) >= 58;
}

document.onreadystatechange = function() {
	var ulData; // Not initializing here as window.PAYPAL.ulData may not be available before readyState is complete
	var splitLoginContext = login.utils.getSplitLoginContext();
	var intent = login.utils.getIntent();
	var cookieBannerEnabled = $('body').data('cookieBannerEnabled');
	var oneTouchUser = $('body').data('oneTouchUser');
	var setBuyer = document.querySelector('input[name="setBuyer"]');
	var loadStartTime = $('body').data('loadStartTime');
	var isCookiedUser = $('body').data('isCookiedUser');
	if (document.readyState === 'complete') {
		login.logger.log({evt: 'transition_name', data: 'cpl_prepare_login_ul', instrument: true});
		login.utils.logCPLData({ startTime: loadStartTime, status: 'success',
			flowName: isCookiedUser? 'Hybrid Login Cookied': 'Hybrid Login Uncookied' });
		login.bootstrap();
		// At the end start to load calling app specific resource url
		ulData = (window.PAYPAL && window.PAYPAL.ulData) || {};
		if (ulData.preloadScriptUrl) {
			asyncLoadAssetUrls(ulData.preloadScriptUrl);
		}
		if (splitLoginContext) {
			instrumentSplitLoginPageLoad(splitLoginContext);
		} else {
			if (intent === 'checkout') {
				instrumentUlAsLandingPageLoad();
			}
			if (intent === 'prox') {
				instrumentProx();
			}
		}

		// Top level click event
		// TODO: Plan out strategy for using this optimally
		addEvent(document, 'click', login.utils.documentClickHandler);
		// TODO: Plan where to `subcribe`.. should it be in the view OR in one place its.
		login.pubsub.subscribe('WINDOW_CLICK', login.utils.toggleRememberInfoTooltip);
		login.pubsub.subscribe('WINDOW_CLICK', function(e) {
			var target = getEventTarget(e);
			var actionType = $(target).data('clientLogActionType');
			if (actionType) {
				login.logger.log({
					evt: 'actiontype',
					data: actionType,
					instrument: true
				});
				login.logger.pushLogs();
			}
		})

		showReturnToMerchantLink();

		if (ulData.fingerprintProceed === 'lookup' && fingerprint) {
			fingerprint.lookup();
		}

		if (ulData.fingerprintProceed === 'login' && fingerprint) {
			fingerprint.login();
		}
		if (cookieBannerEnabled && !oneTouchUser) {
			login.loadResources && login.loadResources.showCookieBanner();
		}
		if (login.utils.isAppDownloadBannerSupported() && login.loadResources) {
			login.loadResources.showAppDownloadBanner();
		}
		login.loadResources && login.loadResources.lazyload();
		if (setBuyer) {
			setTimeout(function () {
				login.utils.isFnDataLoaded() && login.xoPlanning.triggerSetBuyerCall(setBuyer.value);
			}, 300);
		}
	}
};
}());
