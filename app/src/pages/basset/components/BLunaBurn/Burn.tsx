import { createHookMsg } from '@anchor-protocol/anchor.js/dist/utils/cw20/create-hook-msg';
import { validateTxFee } from '@anchor-protocol/app-fns';
import {
  useAnchorBank,
  useAnchorWebapp,
  useBLunaExchangeRateQuery,
  useBondBurnTx,
} from '@anchor-protocol/app-provider';
import {
  formatLuna,
  formatLunaInput,
  formatUST,
  LUNA_INPUT_MAXIMUM_DECIMAL_POINTS,
  LUNA_INPUT_MAXIMUM_INTEGER_POINTS,
} from '@anchor-protocol/notation';
import { bLuna } from '@anchor-protocol/types';
import { useEstimateFee } from '@libs/app-provider';
import { floor } from '@libs/big-math';
import { demicrofy, MICRO } from '@libs/formatter';
import { ActionButton } from '@libs/neumorphism-ui/components/ActionButton';
import { IconSpan } from '@libs/neumorphism-ui/components/IconSpan';
import { NumberMuiInput } from '@libs/neumorphism-ui/components/NumberMuiInput';
import { SelectAndTextInputContainer } from '@libs/neumorphism-ui/components/SelectAndTextInputContainer';
import { useAlert } from '@libs/neumorphism-ui/components/useAlert';
import { Gas, Luna, u, UST } from '@libs/types';
import { StreamStatus } from '@rx-stream/react';
import { Msg, MsgExecuteContract } from '@terra-money/terra.js';
import big, { Big } from 'big.js';
import { MessageBox } from 'components/MessageBox';
import { IconLineSeparator } from 'components/primitives/IconLineSeparator';
import { TxResultRenderer } from 'components/tx/TxResultRenderer';
import { SwapListItem, TxFeeList, TxFeeListItem } from 'components/TxFeeList';
import { ViewAddressWarning } from 'components/ViewAddressWarning';
import debounce from 'lodash.debounce';
import { pegRecovery } from 'pages/bond/logics/pegRecovery';
import { validateBurnAmount } from 'pages/bond/logics/validateBurnAmount';
import React, {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { BurnComponent } from './types';

export interface BurnProps extends BurnComponent {}

export function Burn({
  burnAmount,
  getAmount,
  setGetAmount,
  setBurnAmount,
  connectedWallet,
  fixedFee,
  setMode,
}: BurnProps) {
  // ---------------------------------------------
  // dependencies
  // ---------------------------------------------
  const { contractAddress, gasPrice, constants } = useAnchorWebapp();

  const estimateFee = useEstimateFee(connectedWallet?.walletAddress);

  const [burn, burnResult] = useBondBurnTx();

  const [openAlert, alertElement] = useAlert();

  // ---------------------------------------------
  // states
  // ---------------------------------------------
  const [estimatedGasWanted, setEstimatedGasWanted] = useState<Gas | null>(
    null,
  );
  const [estimatedFee, setEstimatedFee] = useState<u<UST> | null>(null);

  // ---------------------------------------------
  // queries
  // ---------------------------------------------
  const bank = useAnchorBank();

  const { data: { state: exchangeRate, parameters } = {} } =
    useBLunaExchangeRateQuery();

  // ---------------------------------------------
  // logics
  // ---------------------------------------------
  const pegRecoveryFee = useMemo(
    () => pegRecovery(exchangeRate, parameters),
    [exchangeRate, parameters],
  );

  const invalidTxFee = useMemo(
    () => !!connectedWallet && validateTxFee(bank.tokenBalances.uUST, fixedFee),
    [bank, fixedFee, connectedWallet],
  );

  const invalidBurnAmount = useMemo(
    () => !!connectedWallet && validateBurnAmount(burnAmount, bank),
    [bank, burnAmount, connectedWallet],
  );

  const estimate = useMemo(() => {
    return debounce((msgs: Msg[] | null) => {
      if (!msgs) {
        setEstimatedGasWanted(null);
        setEstimatedFee(null);
        return;
      }

      estimateFee(msgs).then((estimated) => {
        if (estimated) {
          setEstimatedGasWanted(estimated.gasWanted);
          setEstimatedFee(
            big(estimated.txFee).mul(gasPrice.uusd).toFixed() as u<UST>,
          );
        } else {
          setEstimatedGasWanted(null);
          setEstimatedFee(null);
        }
      });
    }, 500);
  }, [estimateFee, gasPrice.uusd]);

  // ---------------------------------------------
  // callbacks
  // ---------------------------------------------
  const updateBurnAmount = useCallback(
    (nextBurnAmount: string) => {
      if (nextBurnAmount.trim().length === 0) {
        setGetAmount('' as Luna);
        setBurnAmount('' as bLuna);
      } else {
        const burnAmount: bLuna = nextBurnAmount as bLuna;
        const getAmount: Luna = formatLunaInput(
          big(burnAmount).mul(exchangeRate?.exchange_rate ?? 1) as Luna<Big>,
        );

        setGetAmount(getAmount);
        setBurnAmount(burnAmount);
      }
    },
    [exchangeRate?.exchange_rate, setBurnAmount, setGetAmount],
  );

  const updateGetAmount = useCallback(
    (nextGetAmount: string) => {
      if (nextGetAmount.trim().length === 0) {
        setBurnAmount('' as bLuna);
        setGetAmount('' as Luna);
      } else {
        const getAmount: Luna = nextGetAmount as Luna;
        const burnAmount: bLuna = formatLunaInput(
          big(getAmount).div(exchangeRate?.exchange_rate ?? 1) as bLuna<Big>,
        );

        setBurnAmount(burnAmount);
        setGetAmount(getAmount);
      }
    },
    [exchangeRate?.exchange_rate, setBurnAmount, setGetAmount],
  );

  const init = useCallback(() => {
    setGetAmount('' as Luna);
    setBurnAmount('' as bLuna);
  }, [setBurnAmount, setGetAmount]);

  const proceed = useCallback(
    async (burnAmount: bLuna) => {
      if (!connectedWallet || !burn) {
        return;
      }

      const estimated = await estimateFee([
        new MsgExecuteContract(
          connectedWallet.terraAddress,
          contractAddress.cw20.bLuna,
          {
            send: {
              contract: contractAddress.bluna.hub,
              amount: floor(big(burnAmount).mul(MICRO)).toFixed(),
              msg: createHookMsg({
                unbond: {},
              }),
            },
          },
        ),
      ]);

      if (estimated) {
        burn({
          burnAmount,
          gasWanted: estimated.gasWanted,
          txFee: big(estimated.txFee).mul(gasPrice.uusd).toFixed() as u<UST>,
          onTxSucceed: () => {
            init();
          },
        });
      } else {
        await openAlert({
          description: (
            <>
              Broadcasting failed,
              <br />
              please retry after some time.
            </>
          ),
          agree: 'OK',
        });
      }
    },
    [
      burn,
      connectedWallet,
      contractAddress.bluna.hub,
      contractAddress.cw20.bLuna,
      estimateFee,
      gasPrice.uusd,
      init,
      openAlert,
    ],
  );

  // ---------------------------------------------
  // effects
  // ---------------------------------------------
  useEffect(() => {
    if (!connectedWallet || burnAmount.length === 0) {
      setEstimatedGasWanted(null);
      setEstimatedFee(null);
      estimate(null);
      return;
    }

    const amount = floor(big(burnAmount).mul(MICRO));

    if (amount.lt(0) || amount.gt(bank.tokenBalances.ubLuna ?? 0)) {
      setEstimatedGasWanted(null);
      setEstimatedFee(null);
      estimate(null);
      return;
    }

    estimate([
      new MsgExecuteContract(
        connectedWallet.terraAddress,
        contractAddress.cw20.bLuna,
        {
          send: {
            contract: contractAddress.bluna.hub,
            amount: amount.toFixed(),
            msg: createHookMsg({
              unbond: {},
            }),
          },
        },
      ),
    ]);
  }, [
    bank.tokenBalances.ubLuna,
    burnAmount,
    connectedWallet,
    constants.bondGasWanted,
    contractAddress.bluna.hub,
    contractAddress.cw20.bLuna,
    estimate,
    estimateFee,
    fixedFee,
    gasPrice.uusd,
  ]);

  useEffect(() => {
    if (burnAmount.length > 0) {
      updateBurnAmount(burnAmount);
    }
    //eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------
  // presentation
  // ---------------------------------------------
  if (
    burnResult?.status === StreamStatus.IN_PROGRESS ||
    burnResult?.status === StreamStatus.DONE
  ) {
    return (
      <TxResultRenderer
        resultRendering={burnResult.value}
        onExit={() => {
          init();
          switch (burnResult.status) {
            case StreamStatus.IN_PROGRESS:
              burnResult.abort();
              break;
            case StreamStatus.DONE:
              burnResult.clear();
              break;
          }
        }}
      />
    );
  }

  return (
    <>
      {!!invalidTxFee && <MessageBox>{invalidTxFee}</MessageBox>}

      {pegRecoveryFee && (
        <MessageBox
          level="info"
          hide={{ id: 'burn_peg', period: 1000 * 60 * 60 * 24 * 7 }}
        >
          When exchange rate is lower than threshold,
          <br />
          protocol charges peg recovery fee for each Mint/Burn action.
        </MessageBox>
      )}

      <MessageBox
        level="info"
        hide={{ id: 'burn', period: 1000 * 60 * 60 * 24 * 7 }}
      >
        Default bLuna redemptions take at least 21 days to process.
        <br />
        Slashing events during the 21 days may affect the final amount
        withdrawn.
        <br />
        Redemptions are processed in 3-day batches and may take up to 24 days.
      </MessageBox>

      {/* Burn (bAsset) */}
      <div className="burn-description">
        <p>I want to burn</p>
        <p />
      </div>

      <SelectAndTextInputContainer
        className="burn"
        gridColumns={[120, '1fr']}
        error={!!invalidBurnAmount}
        leftHelperText={invalidBurnAmount}
        rightHelperText={
          !!connectedWallet && (
            <span>
              Balance:{' '}
              <span
                style={{ textDecoration: 'underline', cursor: 'pointer' }}
                onClick={() =>
                  updateBurnAmount(
                    formatLunaInput(demicrofy(bank.tokenBalances.ubLuna)),
                  )
                }
              >
                {formatLuna(demicrofy(bank.tokenBalances.ubLuna))} bLuna
              </span>
            </span>
          )
        }
      >
        <div>bLuna</div>
        <NumberMuiInput
          placeholder="0.00"
          error={!!invalidBurnAmount}
          value={burnAmount}
          maxIntegerPoinsts={LUNA_INPUT_MAXIMUM_INTEGER_POINTS}
          maxDecimalPoints={LUNA_INPUT_MAXIMUM_DECIMAL_POINTS}
          onChange={({ target }: ChangeEvent<HTMLInputElement>) =>
            updateBurnAmount(target.value)
          }
        />
      </SelectAndTextInputContainer>

      <IconLineSeparator />

      {/* Get (Asset) */}
      <div className="gett-description">
        <p>and get</p>
        <p />
      </div>

      <SelectAndTextInputContainer
        className="gett"
        gridColumns={[120, '1fr']}
        error={!!invalidBurnAmount}
      >
        <div>Luna</div>
        <NumberMuiInput
          placeholder="0.00"
          error={!!invalidBurnAmount}
          value={getAmount}
          maxIntegerPoinsts={LUNA_INPUT_MAXIMUM_INTEGER_POINTS}
          maxDecimalPoints={LUNA_INPUT_MAXIMUM_DECIMAL_POINTS}
          onChange={({ target }: ChangeEvent<HTMLInputElement>) =>
            updateGetAmount(target.value)
          }
        />
      </SelectAndTextInputContainer>

      <div>
        <button onClick={() => setMode('swap')}>Instant Burn</button>
      </div>

      <TxFeeList className="receipt">
        {exchangeRate && (
          <SwapListItem
            label="Price"
            currencyA="bLuna"
            currencyB="Luna"
            exchangeRateAB={exchangeRate.exchange_rate}
            formatExchangeRate={(ratio) => formatLuna(ratio as Luna<Big>)}
          />
        )}
        {!!pegRecoveryFee && getAmount.length > 0 && (
          <TxFeeListItem label={<IconSpan>Peg Recovery Fee</IconSpan>}>
            {formatLuna(demicrofy(pegRecoveryFee(getAmount)))} LUNA
          </TxFeeListItem>
        )}
        {burnAmount.length > 0 && estimatedFee && (
          <TxFeeListItem label={<IconSpan>Estimated Tx Fee</IconSpan>}>
            ≈ {formatUST(demicrofy(estimatedFee))} UST
          </TxFeeListItem>
        )}
      </TxFeeList>

      {/* Submit */}
      <ViewAddressWarning>
        <ActionButton
          className="submit"
          disabled={
            !connectedWallet ||
            !connectedWallet.availablePost ||
            !burn ||
            burnAmount.length === 0 ||
            big(burnAmount).lte(0) ||
            !!invalidTxFee ||
            !!invalidBurnAmount ||
            estimatedGasWanted === null ||
            estimatedFee === null
          }
          onClick={() => proceed(burnAmount)}
        >
          Burn
        </ActionButton>
      </ViewAddressWarning>

      {alertElement}
    </>
  );
}