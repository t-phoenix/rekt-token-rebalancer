import axios from 'axios';

export async function getCoinData(mintStr: string): Promise<any | null> {
  try {
    const url = `https://frontend-api-v3.pump.fun/coins/${mintStr}`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0',
        Accept: '*/*',
        Referer: 'https://www.pump.fun/',
        Origin: 'https://www.pump.fun',
      },
      timeout: 10_000,
    });

    if (response.status === 200) return response.data;
    return null;
  } catch {
    return null;
  }
}
