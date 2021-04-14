import {
  ChromeExtensionClient,
  ChromeExtensionStatus,
  StationNetworkInfo,
} from '@terra-dev/extension';
import { isDesktopChrome } from '@terra-dev/is-desktop-chrome';
import {
  connectWallet,
  connectWalletIfSessionExists,
  SessionStatus,
  TxResult,
  WalletConnectController,
  WalletConnectControllerOptions,
} from '@terra-dev/walletconnect';
import { AccAddress, CreateTxOptions } from '@terra-money/terra.js';
import { BehaviorSubject, combineLatest, interval, race } from 'rxjs';
import { filter, mapTo } from 'rxjs/operators';
import { NetworkInfo, WalletStatus } from './models';

export interface WalletControllerOptions
  extends WalletConnectControllerOptions {
  defaultNetwork: StationNetworkInfo;
  walletConnectChainIds: Map<number, StationNetworkInfo>;
}

export class WalletController {
  readonly extension: ChromeExtensionClient;
  private walletConnect: WalletConnectController | null = null;

  readonly _status: BehaviorSubject<WalletStatus>;
  readonly _network: BehaviorSubject<NetworkInfo>;
  readonly _walletAddress: BehaviorSubject<string | null>;

  private disableExtension: (() => void) | null = null;
  private disableWalletConnect: (() => void) | null = null;

  constructor(readonly options: WalletControllerOptions) {
    this._status = new BehaviorSubject<WalletStatus>(WalletStatus.INITIALIZING);
    this._network = new BehaviorSubject<NetworkInfo>({
      name: options.defaultNetwork.name,
      chainID: options.defaultNetwork.chainID,
    });
    this._walletAddress = new BehaviorSubject<string | null>(null);

    this.extension = new ChromeExtensionClient({
      enableWalletConnection: true,
      defaultNetwork: options.defaultNetwork,
    });

    const draftWalletConnect = connectWalletIfSessionExists(options);

    if (
      draftWalletConnect &&
      draftWalletConnect.getLatestSession().status === SessionStatus.CONNECTED
    ) {
      this.enableWalletConnect(draftWalletConnect);
    } else if (isDesktopChrome()) {
      const extensionConnectionCheckSubscription = race(
        this.extension
          .status()
          .pipe(
            filter(
              (extensionStatus) =>
                extensionStatus === ChromeExtensionStatus.WALLET_CONNECTED,
            ),
          ),
        interval(1000 * 10).pipe(mapTo(null)),
      ).subscribe({
        next: (status) => {
          if (status === ChromeExtensionStatus.WALLET_CONNECTED) {
            extensionConnectionCheckSubscription.unsubscribe();
            this.enableExtension();
          } else {
            this._status.next(WalletStatus.WALLET_NOT_CONNECTED);
          }
        },
      });
    } else {
      this._status.next(WalletStatus.WALLET_NOT_CONNECTED);
    }
  }

  status = () => {
    return this._status.asObservable();
  };

  network = () => {
    return this._network.asObservable();
  };

  walletAddress = () => {
    return this._walletAddress.asObservable();
  };

  availableExtension = () => {
    return isDesktopChrome();
  };

  enableExtension = () => {
    if (this.disableWalletConnect) {
      this.disableWalletConnect();
      this.disableWalletConnect = null;
    }

    const extensionSubscription = combineLatest([
      this.extension.status(),
      this.extension.networkInfo(),
      this.extension.walletAddress(),
    ]).subscribe({
      next: ([status, networkInfo, walletAddress]) => {
        if (
          status === ChromeExtensionStatus.WALLET_CONNECTED &&
          typeof walletAddress === 'string' &&
          AccAddress.validate(walletAddress)
        ) {
          this._status.next(WalletStatus.WALLET_CONNECTED);
          this._network.next(networkInfo);
          this._walletAddress.next(walletAddress);
        } else {
          this._status.next(WalletStatus.WALLET_NOT_CONNECTED);
          this._network.next(this.options.defaultNetwork);
          this._walletAddress.next(null);
        }
      },
    });

    this.disableExtension = () => {
      extensionSubscription.unsubscribe();
    };
  };

  enableWalletConnect = (walletConnect: WalletConnectController) => {
    if (this.disableExtension) {
      this.disableExtension();
      this.disableExtension = null;
    }

    if (this.walletConnect) {
      this.walletConnect.disconnect();
    }

    this.walletConnect = walletConnect;

    const sessionSubscription = walletConnect.session().subscribe({
      next: (status) => {
        switch (status.status) {
          case SessionStatus.CONNECTED:
            this._status.next(WalletStatus.WALLET_CONNECTED);
            this._network.next(
              this.options.walletConnectChainIds.get(status.chainId)!,
            );
            this._walletAddress.next(status.terraAddress);
            break;
          default:
            this._status.next(WalletStatus.WALLET_NOT_CONNECTED);
            this._network.next(this.options.defaultNetwork);
            this._walletAddress.next(null);
            break;
        }
      },
    });

    this.disableWalletConnect = () => {
      walletConnect.disconnect();
      this.walletConnect = null;
      sessionSubscription.unsubscribe();
    };
  };

  connectToExtension = () => {
    this.extension.connect().then((success) => {
      if (success) {
        this.enableExtension();
      }
    });
  };

  connectToWalletConnect = () => {
    this.enableWalletConnect(connectWallet(this.options));
  };

  disconnect = () => {
    this.disableExtension?.();
    this.disableExtension = null;

    this.disableWalletConnect?.();
    this.disableWalletConnect = null;

    this._status.next(WalletStatus.WALLET_NOT_CONNECTED);
    this._network.next(this.options.defaultNetwork);
    this._walletAddress.next(null);
  };

  post = async (tx: CreateTxOptions): Promise<TxResult> => {
    if (!this.disableExtension && !this.disableWalletConnect) {
      throw new Error(`Wallet not connected!`);
    }

    if (this.disableExtension) {
      return this.extension
        .post<CreateTxOptions, TxResult>(tx)
        .then(({ payload }) => payload);
    } else if (this.walletConnect) {
      return this.walletConnect.post(tx);
    } else {
      throw new Error(`Can't post tx. there is no connected session!`);
    }
  };
}
