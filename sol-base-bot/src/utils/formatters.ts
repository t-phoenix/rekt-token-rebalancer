/**
 * Utility functions for formatting output data
 */

/**
 * Formats a table with headers and rows
 */
export function formatTable(headers: string[], rows: string[][]): string {
  const colWidths = headers.map((_, i) => {
    const maxWidth = Math.max(
      headers[i].length,
      ...rows.map(row => (row[i] || '').length)
    );
    return Math.max(maxWidth, 10);
  });

  const formatRow = (cells: string[]) => {
    return '| ' + cells.map((cell, i) => (cell || '').padEnd(colWidths[i])).join(' | ') + ' |';
  };

  const separator = '+-' + colWidths.map(w => '-'.repeat(w)).join('-+-') + '-+';
  
  let result = separator + '\n';
  result += formatRow(headers) + '\n';
  result += separator + '\n';
  rows.forEach(row => {
    result += formatRow(row) + '\n';
  });
  result += separator;
  
  return result;
}

/**
 * Formats balance data into a table
 */
export function formatBalanceTable(solana: any, base: any): string {
  const headers = ['Chain', 'Asset', 'Balance', 'Status'];
  const rows: string[][] = [];

  if (solana && solana !== 'not_available') {
    rows.push(['Solana', 'SOL', `${solana.sol}`, solana.sol < 0.1 ? '⚠️  Low' : '✓ OK']);
    rows.push(['Solana', 'Token', `${solana.token}`, '']);
  } else {
    rows.push(['Solana', 'N/A', 'Not Available', '']);
  }

  if (base && base !== 'not_available') {
    rows.push(['Base', 'ETH', `${base.eth}`, base.eth < 0.01 ? '⚠️  Low' : '✓ OK']);
    rows.push(['Base', 'USDC', `${base.usdc}`, base.usdc < 10 ? '⚠️  Low' : '✓ OK']);
    rows.push(['Base', 'Token', `${base.token}`, '']);
  } else {
    rows.push(['Base', 'N/A', 'Not Available', '']);
  }

  return formatTable(headers, rows);
}

/**
 * Formats a number with appropriate decimal places
 * For very small values, shows more decimals to ensure visibility
 */
export function formatNumber(value: number, minDecimals: number = 6, maxDecimals: number = 18): string {
  if (value === 0) {
    return '0';
  }
  
  const absValue = Math.abs(value);
  
  // For very small values, find the first non-zero digit
  if (absValue < 1 && absValue > 0) {
    // Convert to string to find the position of first non-zero digit
    const valueStr = absValue.toFixed(maxDecimals);
    const decimalIndex = valueStr.indexOf('.');
    
    if (decimalIndex !== -1) {
      // Find first non-zero digit after decimal point
      let firstNonZeroIndex = decimalIndex + 1;
      while (firstNonZeroIndex < valueStr.length && valueStr[firstNonZeroIndex] === '0') {
        firstNonZeroIndex++;
      }
      
      if (firstNonZeroIndex < valueStr.length) {
        // Show at least 2 significant digits after the first non-zero
        const decimalsNeeded = firstNonZeroIndex - decimalIndex + 1; // +1 for the first non-zero, +1 more for second digit
        const decimals = Math.max(minDecimals, Math.min(decimalsNeeded, maxDecimals));
        return value.toFixed(decimals).replace(/\.?0+$/, '');
      }
    }
  }
  
  // For larger values or if we couldn't determine, use the minimum decimals
  return value.toFixed(minDecimals).replace(/\.?0+$/, '');
}

