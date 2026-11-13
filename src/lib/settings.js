export const DEFAULT_SETTINGS = {
  minimum: 100000,
  side: "both",
  maxPositions: 50,
  maxBubbles: 75,
  lookback: 3600000,
  showPositions: true,
  showCloses: true,
  showLiquidations: true,
  sma9: true,
  sma21: true,
  sma50: true,
  sma200: true,
};

export const EVENT_LAYERS = [
  {
    key: "showPositions",
    label: "Positions",
    description: "Open entry-price lines",
    icon: "line",
  },
  {
    key: "showCloses",
    label: "Closes",
    description: "Exit markers",
    icon: "close",
  },
  {
    key: "showLiquidations",
    label: "Liquidations",
    description: "Notional-sized bubbles",
    icon: "bubble",
  },
];

export const AVERAGES = [
  { period: 9, key: "sma9", color: "bg-sma9" },
  { period: 21, key: "sma21", color: "bg-sma21" },
  { period: 50, key: "sma50", color: "bg-sma50" },
  { period: 200, key: "sma200", color: "bg-sma200" },
];

export const LOOKBACKS = [
  { value: 900000, label: "15 minutes" },
  { value: 3600000, label: "1 hour" },
  { value: 14400000, label: "4 hours" },
  { value: 86400000, label: "24 hours" },
];
