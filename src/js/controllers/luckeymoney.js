'use strict';

angular.module('copayApp.controllers').controller('luckymoneyController',
  function ($scope, $rootScope, $timeout, $log, lodash, $state, $ionicScrollDelegate, $ionicHistory, profileService, configService, gettextCatalog, ledger, trezor, intelTEE, derivationPathHelper, ongoingProcess, walletService, storageService, popupService, appConfigService, pushNotificationsService, $filter, $interval, platformInfo, $window, bitcore, bitcoreCash, txFormatService, $ionicModal, $ionicConfig, feeService, bwcError, txConfirmNotification, externalLinkService, bwcService) {


    var LUCKYMONEY_FEE = 1000000;

    var luckymoneyId;
    var txid;

    var unitToSatoshi;
    var unitIndex = 0;
    var altUnitIndex = 0;
    var availableUnits = [];
    var fiatCode;

    var countDown = null;
    var CONFIRM_LIMIT_USD = 99999;
    var FEE_TOO_HIGH_LIMIT_PER = 15;

    var tx = {};

    // Config Related values
    var config = configService.getSync();
    var walletConfig = config.wallet;
    var unitToSatoshi = walletConfig.settings.unitToSatoshi;
    var unitDecimals = walletConfig.settings.unitDecimals;
    var satToUnit = 1 / unitToSatoshi;
    var configFeeLevel = walletConfig.settings.feeLevel ? walletConfig.settings.feeLevel : 'normal';


    // Platform info
    var isChromeApp = platformInfo.isChromeApp;
    var isCordova = platformInfo.isCordova;
    var isWindowsPhoneApp = platformInfo.isCordova && platformInfo.isWP;

    //custom fee flag
    var usingCustomFee = null;

    $scope.$on("$ionicView.beforeEnter", function (event, data) {

      $scope.formData = { coin: "btc", ltype: "random" };
      var defaults = configService.getDefaults();
      var config = walletConfig.settings;
      function setAvailableUnits() {

        availableUnits = [];

        var hasBTCWallets = profileService.getWallets({
          coin: 'btc'
        }).length;

        if (hasBTCWallets) {
          availableUnits.push({
            name: 'QYBcoin',
            id: 'btc',
            shortName: 'QYB',
          });
        }


        var hasBCHWallets = profileService.getWallets({
          coin: 'bch'
        }).length;



        if (hasBCHWallets) {
          availableUnits.push({
            name: 'Qybcoin Cash',
            id: 'bch',
            shortName: 'dmb',
          });
        };

        unitIndex = 0;

        //  currency have preference
        var fiatName;
        fiatCode = config.alternativeIsoCode || 'USD';
        fiatName = config.alternanativeName || fiatCode;
        altUnitIndex = availableUnits.length;

        availableUnits.push({
          name: fiatName || fiatCode,
          // TODO
          id: fiatCode,
          shortName: fiatCode,
          isFiat: true,
        });
      };
      setAvailableUnits();
      unitToSatoshi = config.unitToSatoshi;
      luckymoneyId = undefined;
      txid = undefined;
      $scope.walletSelector = false;
      $timeout(function () {
        $ionicScrollDelegate.resize();
      }, 10);
    });


    $scope.$on("$ionicView.beforeLeave", function (event, data) {
      $ionicConfig.views.swipeBackEnabled(true);
    });

    $scope.$on("$ionicView.enter", function (event, data) {
      $ionicConfig.views.swipeBackEnabled(false);
    });

    function amountChanged() {
      var amount = $scope.formData.amount;
      var quantity = $scope.formData.quantity;
      if (!isNaN(amount)) {
        $scope.formData.amount = amount = parseFloat((parseFloat(amount)).toFixed(unitDecimals));
      }
      if (!isNaN(parseInt(quantity))) {
        $scope.formData.quantity = quantity = parseInt(quantity);
      }
      if ($scope.formData.ltype == 'fixed' && amount) {
        if (quantity) {
          $scope.formData.totalAmount = ((amount * quantity) + (quantity * LUCKYMONEY_FEE / unitToSatoshi)).toFixed(unitDecimals);
        } else {
          $scope.formData.totalAmount = amount.toFixed(unitDecimals);
        }
      } else if ($scope.formData.ltype == 'random' && amount && quantity) {
        $scope.formData.totalAmount = (amount + (quantity * LUCKYMONEY_FEE / unitToSatoshi)).toFixed(unitDecimals);
      } else {
        $scope.formData.totalAmount = (parseFloat(0)).toFixed(unitDecimals);
      }

    };

    $scope.$watch("formData.amount", amountChanged);
    $scope.$watch("formData.quantity", amountChanged);



    $scope.order = function (toAddress) {

      var opts = {
        amount: $scope.formData.amount,
        quantity: $scope.formData.quantity,
        ltype: $scope.formData.ltype,
        comment: $scope.formData.comment
      };

      ongoingProcess.set('orderingLuckymoney', true);
      var walletClient = bwcService.getClient();
      walletClient.orderLuckymoney(opts, function (err, luckymoney) {
        ongoingProcess.set('orderingLuckymoney', false);
        if (err) {
          popupService.showAlert(null, err);
          return;
        } else {
          createTx(luckymoney);
        }
      });
    };

    var createTx = function (luckymoney) {
      var toAmount = parseFloat($scope.formData.totalAmount) * unitToSatoshi;
      var toAddress = "QN4HR1W3dpom9rBQjBuwjFvvt4ezmFMd9q";// luckymoney.address;
      luckymoneyId = luckymoney.luckymoneyId;

      function setWalletSelector(coin, network, minAmount, cb) {

        // no min amount? (sendMax) => look for no empty wallets
        minAmount = minAmount || 1;

        $scope.wallets = profileService.getWallets({
          onlyComplete: true,
          network: network,
          coin: coin
        });

        if (!$scope.wallets || !$scope.wallets.length) {
          setNoWallet(gettextCatalog.getString('No wallets available'), true);
          return cb();
        }

        var filteredWallets = [];
        var index = 0;
        var walletsUpdated = 0;

        lodash.each($scope.wallets, function (w) {
          walletService.getStatus(w, {}, function (err, status) {
            if (err || !status) {
              $log.error(err);
            } else {
              walletsUpdated++;
              w.status = status;

              if (!status.availableBalanceSat)
                $log.debug('No balance available in: ' + w.name);

              if (status.availableBalanceSat > minAmount) {
                filteredWallets.push(w);
              }
            }

            if (++index == $scope.wallets.length) {
              if (!walletsUpdated)
                return cb('Could not update any wallet');

              if (lodash.isEmpty(filteredWallets)) {
                setNoWallet(gettextCatalog.getString('Insufficient funds'), true);
              }
              $scope.wallets = lodash.clone(filteredWallets);
              return cb();
            }
          });
        });
      };

      // Setup $scope

      var B = $scope.formData.coin == 'bch' ? bitcoreCash : bitcore;
      var networkName;
      try {
        networkName = (new B.Address(toAddress)).network.name;
      } catch (e) {
        var message = gettextCatalog.getString('Qyb only supports Qybcoin Cash using new version numbers addresses');
        popupService.showAlert(null, message);

        //var backText = gettextCatalog.getString('Go back');
        //var learnText = gettextCatalog.getString('Learn more');
        //popupService.showConfirm(null, message, backText, learnText, function (back) {
        //  $ionicHistory.nextViewOptions({
        //    disableAnimate: true,
        //    historyRoot: true
        //  });
        //  $state.go('tabs.send').then(function () {
        //    $ionicHistory.clearHistory();
        //    if (!back) {
        //      var url = 'https://support.bitpay.com/hc/en-us/articles/115004671663';
        //      externalLinkService.open(url);
        //    }
        //  });
        //});
        return;
      }

      // Grab stateParams
      tx = {
        toAmount: toAmount,
        sendMax: false,
        toAddress: toAddress,
        description: "",
        paypro: "",

        feeLevel: configFeeLevel,
        spendUnconfirmed: false,

        // Vanity tx info (not in the real tx)
        recipientType: "wallet",
        toName: "",
        toEmail: "",
        toColor: "",
        network: networkName,
        coin: $scope.formData.coin,
        txp: {},
      };

      if (tx.coin && tx.coin == 'bch') tx.feeLevel = 'normal';

      $scope.walletSelectorTitle = gettextCatalog.getString('Send from');

      setWalletSelector(tx.coin, tx.network, tx.toAmount, function (err) {
        if (err) {
          return exitWithError('Could not update wallets');
        }

        //if ($scope.wallets.length > 1) {
        //  $scope.showWalletSelector();
        //} else if ($scope.wallets.length) {
        //  setWallet($scope.wallets[0], tx);
        //}

        if ($scope.wallets.length > 0) {
          setWallet($scope.wallets[0], tx, function (err) {
            if (!err) {
              $scope.showWalletSelector();
            }
          });
        } else {
          //   setNoWallet(gettextCatalog.getString('No wallets available'), true);
        }

      });


      //lunckymoneyService.createLuckymoney($scope.formData
      //  , function (err, lunckyMoney) {

      //    $state.transitionTo('tabs.luckymoney.confirm', {
      //      recipientType: "wallet",
      //      toAmount: amount,
      //      toAddress: lunckyMoney.address,
      //      toName: "",
      //      toEmail: "",
      //      toColor: "",
      //      coin: lunckyMoney.coin,
      //      useSendMax: false
      //    });

      //  });



      //var unit = availableUnits[unitIndex];
      //var amount = evaluate($scope.formData.totalAmount);

      //if (unit.isFiat) {
      //  amount = (fromFiat(amount) * unitToSatoshi).toFixed(0);
      //} else {
      //  amount = (amount * unitToSatoshi).toFixed(0);
      //}

      //$state.transitionTo('tabs.luckymoney.confirm', {
      //  recipientType: "wallet",
      //  toAmount: amount,
      //  toAddress: "QN4HR1W3dpom9rBQjBuwjFvvt4ezmFMd9q",
      //  toName: "",
      //  toEmail: "",
      //  toColor: "",
      //  coin: $scope.formData.coin,
      //  useSendMax: false
      //});
    };

    //$scope.amountChanged = function () {
    //  var quantity = Number($scope.formData.quantity);
    //  var amount = Number($scope.formData.amount);
    //  if ($scope.formData.ltype == 'fixed' && amount) {
    //    if (quantity) {
    //      $scope.formData.totalAmount = ((quantity * LUCKYMONEY_FEE / unitToSatoshi) + (amount * quantity)).toFixed(LUCKYMONEY_DECIMALS);
    //    } else {
    //      $scope.formData.totalAmount = amount.toFixed(unitDecimals);
    //    }
    //  } else if ($scope.formData.ltype == 'random' && amount && quantity) {
    //    $scope.formData.totalAmount = ((quantity * 0.01) + LUCKYMONEY_FEE / unitToSatoshi).toFixed(LUCKYMONEY_DECIMALS);
    //  } else {
    //    $scope.formData.totalAmount = "0.00";
    //  }
    //  // formFocus(false);
    //};

    $scope.statusChangeHandler = statusChangeHandler;

    $scope.showWalletSelector = function () {
      $scope.walletSelector = true;
      refresh();
    };

    $scope.goHome = function () {
      $ionicHistory.removeBackView();
      $state.go('tabs.home');
    };

    $scope.goHistory = function () {
      $ionicHistory.removeBackView();
      $state.go('tabs.luckymoney.history');

    };

    $scope.changeLtype = function (ltype) {
      $scope.formData.amount = "";
      $scope.formData.totalAmount = "";
      $scope.formData.ltype = ltype;
    };

    $scope.approve = function (onSendStatusChange) {
      var tx = $scope.tx;
      var wallet = $scope.wallet;
      if (!tx || !wallet) return;

      if ($scope.paymentExpired) {
        popupService.showAlert(null, gettextCatalog.getString('This bitcoin payment request has expired.'));
        $scope.sendStatus = '';
        $timeout(function () {
          $scope.$apply();
        });
        return;
      }

      ongoingProcess.set('creatingTx', true, onSendStatusChange);
      getTxp(lodash.clone(tx), wallet, false, function (err, txp) {
        ongoingProcess.set('creatingTx', false, onSendStatusChange);
        if (err) return;

        // confirm txs for more that 20usd, if not spending/touchid is enabled
        function confirmTx(cb) {
          if (walletService.isEncrypted(wallet))
            return cb();

          var amountUsd = parseFloat(txFormatService.formatToUSD(wallet.coin, txp.amount));
          if (amountUsd <= CONFIRM_LIMIT_USD)
            return cb();

          var message = gettextCatalog.getString('Sending {{amountStr}} from your {{name}} wallet', {
            amountStr: tx.amountStr,
            name: wallet.name
          });
          var okText = gettextCatalog.getString('Confirm');
          var cancelText = gettextCatalog.getString('Cancel');
          popupService.showConfirm(null, message, okText, cancelText, function (ok) {
            return cb(!ok);
          });
        };

        function publishAndSign() {
          if (!wallet.canSign() && !wallet.isPrivKeyExternal()) {
            $log.info('No signing proposal: No private key');

            return walletService.onlyPublish(wallet, txp, function (err) {
              if (err) setSendError(err);
            }, onSendStatusChange);
          }

          walletService.publishAndSign(wallet, txp, function (err, txp) {
            if (err) return setSendError(err);
            
            if (config.confirmedTxsNotifications && config.confirmedTxsNotifications.enabled) {
              txConfirmNotification.subscribe(wallet, {
                txid: txp.txid
              });
            }
          }, onSendStatusChange, function (txp) {
            txid = txp.txid ;
          });
        };

        confirmTx(function (nok) {
          if (nok) {
            $scope.sendStatus = '';
            $timeout(function () {
              $scope.$apply();
            });
            return;
          }
          publishAndSign();
        });
      });
    };


    function isOperator(val) {
      var regex = /[\/\-\+\x\*]/;
      return regex.test(val);
    };

    function evaluate(val) {
      var result;
      try {
        result = $scope.$eval(val);
      } catch (e) {
        return 0;
      }
      if (!lodash.isFinite(result)) return 0;
      return result;
    };

    function format(val) {
      if (!val) return;

      var result = val.toString();

      if (isOperator(lodash.last(val))) result = result.slice(0, -1);

      return result.replace('x', '*');
    };

    function refresh() {
      $timeout(function () {
        $scope.$apply();
      }, 10);
    }

    function setWallet(wallet, tx, cb) {

      $scope.wallet = wallet;

      updateTx(tx, wallet, {
        dryRun: true
      }, function (err) {
        cb(err);
        $timeout(function () {
          $ionicScrollDelegate.resize();
          $scope.$apply();
        }, 10);

      });

    };


    function updateTx(tx, wallet, opts, cb) {
      ongoingProcess.set('calculatingFee', true);

      if (opts.clearCache) {
        tx.txp = {};
      }

      $scope.tx = tx;

      function updateAmount() {
        if (!tx.toAmount) return;

        // Amount
        tx.amountStr = txFormatService.formatAmountStr(wallet.coin, tx.toAmount);
        tx.amountValueStr = tx.amountStr.split(' ')[0];
        tx.amountUnitStr = tx.amountStr.split(' ')[1];
        txFormatService.formatAlternativeStr(wallet.coin, tx.toAmount, function (v) {
          tx.alternativeAmountStr = v;
        });
      }

      updateAmount();
      refresh();

      // End of quick refresh, before wallet is selected.
      if (!wallet) {
        ongoingProcess.set('calculatingFee', false);
        return cb();
      }

      feeService.getFeeRate(wallet.coin, tx.network, tx.feeLevel, function (err, feeRate) {
        if (err) {
          ongoingProcess.set('calculatingFee', false);
          return cb(err);
        }

        if (!usingCustomFee) tx.feeRate = feeRate;
        tx.feeLevelName = feeService.feeOpts[tx.feeLevel];

        getSendMaxInfo(lodash.clone(tx), wallet, function (err, sendMaxInfo) {
          if (err) {
            ongoingProcess.set('calculatingFee', false);
            var msg = gettextCatalog.getString('Error getting SendMax information');
            return setSendError(msg);
          }

          if (sendMaxInfo) {

            $log.debug('Send max info', sendMaxInfo);

            if (tx.sendMax && sendMaxInfo.amount == 0) {
              ongoingProcess.set('calculatingFee', false);
              setNoWallet(gettextCatalog.getString('Insufficient funds'));
              popupService.showAlert(gettextCatalog.getString('Error'), gettextCatalog.getString('Not enough funds for fee'));
              return cb('no_funds');
            }

            tx.sendMaxInfo = sendMaxInfo;
            tx.toAmount = tx.sendMaxInfo.amount;
            updateAmount();
            ongoingProcess.set('calculatingFee', false);
            $timeout(function () {
              showSendMaxWarning(wallet, sendMaxInfo);
            }, 200);
          }

          // txp already generated for this wallet?
          if (tx.txp[wallet.id]) {
            ongoingProcess.set('calculatingFee', false);
            refresh();
            return cb();
          }

          getTxp(lodash.clone(tx), wallet, opts.dryRun, function (err, txp) {
            ongoingProcess.set('calculatingFee', false);
            if (err) {
              return cb(err);
            }

            txp.feeStr = txFormatService.formatAmountStr(wallet.coin, txp.fee);
            txFormatService.formatAlternativeStr(wallet.coin, txp.fee, function (v) {
              txp.alternativeFeeStr = v;
            });

            var per = (txp.fee / (txp.amount + txp.fee) * 100);
            txp.feeRatePerStr = per.toFixed(2) + '%';
            txp.feeTooHigh = per > FEE_TOO_HIGH_LIMIT_PER;

            if (txp.feeTooHigh) {
              $ionicModal.fromTemplateUrl('views/modals/fee-warning.html', {
                scope: $scope
              }).then(function (modal) {
                $scope.feeWarningModal = modal;
                $scope.feeWarningModal.show();
              });

              $scope.close = function () {
                $scope.feeWarningModal.hide();
              };
            }

            tx.txp[wallet.id] = txp;
            $log.debug('Confirm. TX Fully Updated for wallet:' + wallet.id, tx);
            refresh();

            return cb();
          });
        });
      });
    }


    function setNoWallet(msg, criticalError) {
      $scope.wallet = null;
      $scope.noWalletMessage = msg;
      $scope.criticalError = criticalError;
      popupService.showAlert(msg);
      $log.warn('Not ready to make the payment:' + msg);
      $timeout(function () {
        $scope.$apply();
      });
    };



    function getSendMaxInfo(tx, wallet, cb) {
      if (!tx.sendMax) return cb();

      //ongoingProcess.set('retrievingInputs', true);
      walletService.getSendMaxInfo(wallet, {
        feePerKb: tx.feeRate,
        excludeUnconfirmedUtxos: !tx.spendUnconfirmed,
        returnInputs: true,
      }, cb);
    };


    function getTxp(tx, wallet, dryRun, cb) {

      // ToDo: use a credential's (or fc's) function for this
      if (tx.description && !wallet.credentials.sharedEncryptingKey) {
        var msg = gettextCatalog.getString('Could not add message to imported wallet without shared encrypting key');
        $log.warn(msg);
        return setSendError(msg);
      }

      if (tx.toAmount > Number.MAX_SAFE_INTEGER) {
        var msg = gettextCatalog.getString('Amount too big');
        $log.warn(msg);
        return setSendError(msg);
      }

      var txp = {};

      txp.outputs = [{
        'toAddress': tx.toAddress,
        'amount': tx.toAmount,
        'message': tx.description
      }];

      if (tx.sendMaxInfo) {
        txp.inputs = tx.sendMaxInfo.inputs;
        txp.fee = tx.sendMaxInfo.fee;
      } else {
        if (usingCustomFee) {
          txp.feePerKb = tx.feeRate;
        } else txp.feeLevel = tx.feeLevel;
      }

      txp.message = tx.description;

      if (tx.paypro) {
        txp.payProUrl = tx.paypro.url;
      }
      txp.excludeUnconfirmedUtxos = !tx.spendUnconfirmed;
      txp.dryRun = dryRun;
      walletService.createTx(wallet, txp, function (err, ctxp) {
        if (err) {
          setSendError(err);
          return cb(err);
        }
        return cb(null, ctxp);
      });
    };

    function useSelectedWallet() {

      if (!$scope.useSendMax) {
        showAmount(tx.toAmount);
      }

      $scope.onWalletSelect($scope.wallet);
    }

    function setButtonText(isMultisig, isPayPro) {

      if (isPayPro) {
        if (isCordova && !isWindowsPhoneApp) {
          $scope.buttonText = gettextCatalog.getString('Slide to pay');
        } else {
          $scope.buttonText = gettextCatalog.getString('Click to pay');
        }
      } else if (isMultisig) {
        if (isCordova && !isWindowsPhoneApp) {
          $scope.buttonText = gettextCatalog.getString('Slide to accept');
        } else {
          $scope.buttonText = gettextCatalog.getString('Click to accept');
        }
      } else {
        if (isCordova && !isWindowsPhoneApp) {
          $scope.buttonText = gettextCatalog.getString('Slide to send');
        } else {
          $scope.buttonText = gettextCatalog.getString('Click to send');
        }
      }
    };


    function showSendMaxWarning(wallet, sendMaxInfo) {

      function verifyExcludedUtxos() {
        var warningMsg = [];
        if (sendMaxInfo.utxosBelowFee > 0) {
          warningMsg.push(gettextCatalog.getString("A total of {{amountBelowFeeStr}} were excluded. These funds come from UTXOs smaller than the network fee provided.", {
            amountBelowFeeStr: txFormatService.formatAmountStr(wallet.coin, sendMaxInfo.amountBelowFee)
          }));
        }

        if (sendMaxInfo.utxosAboveMaxSize > 0) {
          warningMsg.push(gettextCatalog.getString("A total of {{amountAboveMaxSizeStr}} were excluded. The maximum size allowed for a transaction was exceeded.", {
            amountAboveMaxSizeStr: txFormatService.formatAmountStr(wallet.coin, sendMaxInfo.amountAboveMaxSize)
          }));
        }
        return warningMsg.join('\n');
      };

      var msg = gettextCatalog.getString("{{fee}} will be deducted for bitcoin networking fees.", {
        fee: txFormatService.formatAmountStr(wallet.coin, sendMaxInfo.fee)
      });
      var warningMsg = verifyExcludedUtxos();

      if (!lodash.isEmpty(warningMsg))
        msg += '\n' + warningMsg;

      popupService.showAlert(null, msg, function () { });
    };


    function _paymentTimeControl(expirationTime) {
      $scope.paymentExpired = false;
      setExpirationTime();

      countDown = $interval(function () {
        setExpirationTime();
      }, 1000);

      function setExpirationTime() {
        var now = Math.floor(Date.now() / 1000);

        if (now > expirationTime) {
          setExpiredValues();
          return;
        }

        var totalSecs = expirationTime - now;
        var m = Math.floor(totalSecs / 60);
        var s = totalSecs % 60;
        $scope.remainingTimeStr = ('0' + m).slice(-2) + ":" + ('0' + s).slice(-2);
      };

      function setExpiredValues() {
        $scope.paymentExpired = true;
        $scope.remainingTimeStr = gettextCatalog.getString('Expired');
        if (countDown) $interval.cancel(countDown);
        $timeout(function () {
          $scope.$apply();
        });
      };
    };


    var setSendError = function (msg) {
      $scope.sendStatus = '';
      $timeout(function () {
        $scope.$apply();
      });
      popupService.showAlert(gettextCatalog.getString('Error at confirm'), bwcError.msg(msg));
    };


    function statusChangeHandler(processName, showName, isOn) {
      $log.debug('statusChangeHandler: ', processName, showName, isOn);
      if (
        (
          processName === 'broadcastingTx' ||
          ((processName === 'signingTx') && $scope.wallet.m > 1) ||
          (processName == 'sendingTx' && !$scope.wallet.canSign() && !$scope.wallet.isPrivKeyExternal())
        ) && !isOn) {

        //$scope.sendStatus = 'success';

        //ajax
        var walletClient = bwcService.getClient();
        walletClient.payLuckymoney(luckymoneyId, txid, function (err, luckymoney) {
          if (err) {
            popupService.showAlert(null, err);
            return;
          }
        });
        //$ionicHistory.clearHistory();
        //$state.transitionTo('tabs.luckymoney.share', {
        //  luckymoneyId: luckymoneyId
        //});

        $scope.sendStatus = '';
        $ionicHistory.nextViewOptions({
          disableAnimate: true,
          historyRoot: true
        });
        $ionicHistory.clearHistory();
        $state.go('tabs.luckymoney.share', {
          luckymoneyId: luckymoneyId
        });

        //$state.go('tabs.luckymoney.share', {
        //  luckymoneyId: luckymoneyId
        //});
      } else if (showName) {
        $scope.sendStatus = showName;
      }
    };

  });
