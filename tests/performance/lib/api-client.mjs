const defaultApiUrl = 'http://127.0.0.1:3000';

export const getApiConfiguration = () => {
  const apiKey = process.env.PIGEON_API_KEY;

  if (!apiKey) {
    throw new Error('Set PIGEON_API_KEY before running this script.');
  }

  return {
    apiKey,
    apiUrl: (process.env.PIGEON_API_URL ?? defaultApiUrl).replace(/\/$/, ''),
  };
};

export const postToApi = ({ apiKey, apiUrl, path, body }) =>
  fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });
