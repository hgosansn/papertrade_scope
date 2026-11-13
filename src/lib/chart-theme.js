/** Canvas reads the same CSS tokens as the DOM. No separate hardcoded palette. */
export const CHART_THEME_VARIABLES = {
  long: "--long",
  short: "--short",
  axisText: "--chart-axis-text",
  grid: "--chart-grid",
  gridVertical: "--chart-grid-vertical",
  candleUp: "--chart-candle-up",
  candleDown: "--chart-candle-down",
  priceLine: "--chart-price-line",
  priceLabel: "--chart-price-label",
  priceLabelText: "--chart-price-label-text",
  crosshair: "--chart-crosshair",
  transparent: "--chart-transparent",
  sma9: "--sma9",
  sma21: "--sma21",
  sma50: "--sma50",
  sma200: "--sma200",
};

export function readChartTheme(element) {
  const styles = getComputedStyle(element);
  return Object.fromEntries(
    Object.entries(CHART_THEME_VARIABLES).map(([name, variable]) => [
      name,
      styles.getPropertyValue(variable).trim(),
    ]),
  );
}
