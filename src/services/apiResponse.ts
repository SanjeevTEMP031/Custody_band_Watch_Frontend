export function getJsonContentTypeError(
  contentType: string | null,
  apiUrl: string
): string | null {
  const mediaType = contentType?.split(';', 1)[0].trim().toLowerCase() ?? ''
  if (mediaType === 'application/json') return null

  if (mediaType === 'text/html') {
    return `API configuration error for ${apiUrl}: the response is HTML, likely the frontend index.html fallback. Configure VITE_API_BASE_URL to the backend JSON API or provide a working server-side proxy.`
  }
  return `API configuration error for ${apiUrl}: the response Content-Type is ${mediaType || 'missing'}, not application/json. Check VITE_API_BASE_URL and the backend API response.`
}
