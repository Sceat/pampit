import Binance from 'node-binance-api'
import readline from 'readline'
import timers from 'timers/promises'
import debug from 'debug'

const log = debug('Pampit')
const logbuy = log.extend('BUY')
const logsell = log.extend('SELL')
const logthink = log.extend('INFO')
const logpanic = log.extend('PANIC')
const logresult = log.extend('RESULT')
const logerror = log.extend('ERROR')

const { APIKEY, APISECRET } = process.env
const binance = new Binance().options({ APIKEY, APISECRET })
const START_DATE = Date.now()
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

const to_ticker = coin => `${coin.toUpperCase()}BTC`
const fetch_exchange_infos = async () => {
  const { symbols } = await binance.exchangeInfo()
  return symbols.reduce(
    (infos, { filters, symbol }) => ({
      ...infos,
      [symbol]: filters.filter(x => x.filterType !== 'MARKET_LOT_SIZE').reduce((token, filter) => ({ ...token, ...filter }), {}),
    }),
    {}
  )
}

const BTC_BALANCE = await binance.balance().then(x => x.BTC.available)
const { BTCUSDT } = await binance.prices('BTCUSDT')
const EXCHANGE_INFOS = await fetch_exchange_infos()

const clamp_amount = ({ token, amount, price }) => {
  const { minQty, minNotional, stepSize, multiplierUp } = EXCHANGE_INFOS[to_ticker(token)]
  const real_amount = Math.max(amount, +minQty)
  const spending = price * real_amount
  const notional_amount = spending < +minNotional ? +minNotional / price : real_amount
  return binance.roundStep(notional_amount, stepSize)
}

// await input coin Q
// instantly market buy Q
// get token balance Q
// get token price (price bought ?) Q
// place limit sell orders:
// - 100% : 20%
// - 200% : 20%
// - 300% : 20%
// - 400% : 20%
// - 500% : 20%
// await input -> cancel all and market sell

const token_balance = async coin => {
  const balances = await binance.balance()
  return balances[coin.toUpperCase()].available
}

const token_price = async coin => {
  const ticker = to_ticker(coin.toUpperCase())
  const prices = await binance.prices(ticker)
  return +prices[ticker]
}

const market_buy = async coin => {
  const ticker = to_ticker(coin)
  const price = await token_price(coin)
  const quantity = clamp_amount({
    token: coin.toUpperCase(),
    amount: (BTC_BALANCE / price) * 0.98,
    price,
  })
  logthink('want to buy %O at %O', quantity, price)
  await binance.marketBuy(ticker, quantity)
}

const market_sell = async (coin, amount) => {
  const ticker = to_ticker(coin)
  const price = await token_price(coin)
  const quantity = clamp_amount({
    token: coin.toUpperCase(),
    amount,
    price,
  })
  logthink(`want to sell %O at %O`, quantity, price)
  await binance.marketSell(ticker, quantity)
}

const panic = async coin => {
  logpanic('closing orders')
  const ticker = to_ticker(coin.toUpperCase())
  await binance.cancelAll(ticker)
  const price = await token_price(coin)
  const quantity = clamp_amount({
    token: coin.toUpperCase(),
    amount: await token_balance(coin),
    price,
  })
  logpanic('market sell everything')
  await binance.marketSell(ticker, quantity)
}

const get_profit = async () => {
  const profit = (await binance.balance().then(x => x.BTC.available)) - +BTC_BALANCE
  return +profit.toFixed(8)
}

const listen_coin = () =>
  new Promise(res => {
    rl.question('  Enter coin: ', coin => {
      rl.question('\n(PRESS ENTER ANYTIME TO PANIC SELL)\n\n', async () => {
        await panic(coin.toUpperCase())
        const profit = await get_profit()
        logresult('Net profit of %O BTC (%O$)', profit, +(+BTCUSDT * profit).toFixed(2))
        rl.close()
        process.exit(0)
      })
      res(coin?.toUpperCase())
    })
  })

const average_price_bought = async coin => {
  const ticker_name = to_ticker(coin)
  const trades = await binance.trades(ticker_name)

  const get_average = ({ total_bought = 0, total_spent = 0 }) => {
    const average = total_spent / total_bought || 0
    return +average.toFixed(8)
  }
  const average_options = trades
    .filter(({ time }) => time > START_DATE)
    .reduce(
      ({ total_bought = 0, total_spent = 0 }, { price, qty, time }) => ({
        total_bought: +qty + total_bought,
        total_spent: +qty * +price + total_spent,
      }),
      {}
    )

  return get_average(average_options)
}

const limit_sell_maker = (coin, entry) => (limit, quantity) => {
  const real_quantity = clamp_amount({
    token: coin.toUpperCase(),
    amount: quantity,
    price: limit,
  })
  const fixed_limit = +limit.toFixed(8)
  logsell(`placing limit sell order of %O %O at %O (+%O%)`, real_quantity, coin.toUpperCase(), fixed_limit, +((100 * fixed_limit) / entry - 100).toFixed(2))
  return binance.sell(to_ticker(coin), real_quantity, limit.toFixed(8)).catch(error => {
    logerror('Error placing sell order.. %O', error.body)
  })
}

log(`starting pump signal bot with %O BTC (%O$)`, +BTC_BALANCE, +(+BTC_BALANCE * +BTCUSDT).toFixed(2))

const COIN = await listen_coin()
const TICKER = to_ticker(COIN)
const BASE_PRICE = await token_price(COIN)

try {
  logbuy(`buying %O`, TICKER)

  await market_buy(COIN)

  const average_price = await average_price_bought(COIN)
  const balance = await token_balance(COIN)

  logbuy(`bought %O at an average price of %O (base price: %O)`, +balance, average_price, +BASE_PRICE)

  const limit_sell = limit_sell_maker(COIN, average_price)
  const balance_percent = ({ balance, percent }) => (balance * percent) / 100

  const percent_balance = +balance_percent({
    balance,
    percent: 20,
  }).toFixed(8)

  const Prices = {
    x3: BASE_PRICE * 3,
    x4: BASE_PRICE * 4,
    x6: BASE_PRICE * 6,
    x8: BASE_PRICE * 8,
    x10: BASE_PRICE * 10,
  }

  const manual_sell = async () => {
    await timers.setTimeout(1000)
    const recent_price = await token_price(COIN)
    const sell_stack = () => market_sell(COIN, percent_balance)

    logthink(`percent change since entry: %O%`, +((100 * recent_price) / average_price - 100).toFixed(2))

    if (recent_price >= Prices.x6) {
      logsell(`target hit x6 | selling %O %s`, percent_balance, COIN)
      await sell_stack()
    }

    if (recent_price >= Prices.x8) {
      logsell(`target hit x8 | selling %O %s`, percent_balance, COIN)
      await sell_stack()
    }

    if (recent_price >= Prices.x10) {
      logsell(`target hit x10 | selling %O %s`, percent_balance, COIN)
      await sell_stack()
    } else await manual_sell()
  }

  await limit_sell(Prices.x3, percent_balance)
  await limit_sell(Prices.x4, percent_balance)
  // binance doesn't allow a limit bigger than x5

  logthink('Sell orders placed, entering long poll monitoring mode')

  await manual_sell()

  const profit = await get_profit()
  logresult('Net profit of %O BTC (%O$)', profit, +(+BTCUSDT * profit).toFixed(2))
} catch (error) {
  if (error.body) console.error(error.body)
  else console.error(error)
}
