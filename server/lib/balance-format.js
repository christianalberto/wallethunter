function formatBalanceAmount(amount, currency) {
  const num = Number(amount);
  if (!Number.isFinite(num)) {
    return currency ? `${amount} ${currency}` : String(amount);
  }

  const rounded = Math.round(num * 1e5) / 1e5;
  const formatted = rounded.toFixed(5).replace(/\.?0+$/, '');

  return currency ? `${formatted} ${currency}` : formatted;
}

function formatBalanceDisplay(balanceFormatted) {
  if (!balanceFormatted) return '';

  const trimmed = String(balanceFormatted).trim();
  const match = trimmed.match(/^([0-9.eE+-]+)\s+([A-Za-z]+)$/);
  if (!match) return trimmed;

  return formatBalanceAmount(match[1], match[2]);
}

module.exports = {
  formatBalanceAmount,
  formatBalanceDisplay,
};
