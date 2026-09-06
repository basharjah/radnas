import axios from 'axios'

// Separate client for the subscriber portal (its own token, own API prefix).
export const portalApi = axios.create({ baseURL: '/api/portal' })

portalApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('radnas_portal_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})
