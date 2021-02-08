# Pampit mofo

Just don't miss any pumps

## Requirements
use a `.env`

```
APIKEY=xxxxxxxxxxxxx
APISECRET=xxxxxxxxxxxxxxx
```

## Run

```sh
npm run start
```

1. Enter your coin ticker as soon as you have it
2. The bot is going to
   - Market buy
   - Place sell orders at `x3` and `x4` (max on binance is x5 but it can fail)
   - Check for price change every seconds until it can sell at `x6` `x8` and `x10`
   - Stop and show the profit
3. If you press <kbd>ENTER</kbd> the bot will cancel all orders and panic market sell

![](https://i.imgur.com/ASk4cFx.png)