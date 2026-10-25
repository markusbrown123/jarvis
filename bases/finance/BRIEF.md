# Finance: MNQ trading and portfolio (monitoring only)

## What
Futures trading on MNQ (Micro E-mini Nasdaq-100), with QuantVue, and keeping track of the portfolio. JARVIS watches and researches. He does not trade.

## Links
- QuantVue: https://www.quantvue.io/
- Tradovate web trader: https://trader.tradovate.com/welcome
- TradingView chart (MNQ): https://www.tradingview.com/chart/X8WHphqV/

## Where the work is
JARVIS's Finance page: the local services (`master-hub` on :8501, `futures-trader-scout` on :8000), the research repos (`traderedge`, InsiderEdge), the MNQ and MBT charts, and the links above.

## Rules
- Monitoring only: JARVIS never places, changes or cancels an order, and no broker is connected to him.
- No broker or QuantVue login ever goes in a file or in git. Logins stay in the browser or the Keychain.
- Positions, balances and P&L appear only from a real export or a real read-only connection that Markus sets up, with where they came from and how old they are. Nothing is estimated or invented.
- Research is research: no "this will go up", and risk and size are said every time.

## Next
Decide how portfolio figures reach JARVIS read-only (a CSV export, or a read-only data source) — Markus's call. Then the Finance page shows them.

## Status
Links added; monitoring running. No portfolio figures yet.
