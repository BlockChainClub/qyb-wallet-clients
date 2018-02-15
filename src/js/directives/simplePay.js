'use strict';

angular.module('copayApp.directives')
  .directive('simplePay', function ($timeout, lodash) {
    return {
      restrict: 'E',
      templateUrl: 'views/includes/simplePay.html',
      transclude: true,
      scope: {
        title: '=simplePayTitle',
        show: '=simplePayShow',
        wallets: '=simplePayWallets',
        selectedWallet: '=simplePaySelectedWallet',
        onSelect: '=simplePayOnSelect',
        sendStatus: '=simplePaySendStatus',
        statusChangeHandler: '=simplePayStatusChangeHandler',
        approve: '=simplePayApprove',
        isCordova:'=simplePayIsCordova',
        isWindowsPhoneApp:'=simplePayIsWindowsPhoneApp',
      },
      link: function (scope, element, attrs) {

        var separeWallets = function () {
          scope.walletsBtc = [];
          scope.walletsBch = [];
          if (!scope.wallets) return;
          for (var i = 0; i <= scope.wallets.length; i++) {
            if (scope.wallets[i]) {
              if (scope.wallets[i].coin == 'btc') scope.walletsBtc.push(scope.wallets[i]);
              else scope.walletsBch.push(scope.wallets[i]);
            }
          }
        }

        scope.$watch('wallets', function (newVal, oldVal) {
          var isEqual = lodash.isEqual(newVal, oldVal);
          if (!isEqual) separeWallets();
        });

        scope.hide = function () {
          scope.show = false;
        };

        scope.selectWallet = function (wallet) {
          $timeout(function () {
            scope.hide();
          }, 100);
          scope.onSelect(wallet);
        };

        separeWallets();
      }
    };
  });
