import axios from 'axios'

export const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('radnas_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  // The managed host's Apache rejects the DELETE method (405) → tunnel every delete
  // through POST <path>/delete instead. Backend registers matching POST aliases.
  if ((config.method || '').toLowerCase() === 'delete') {
    config.method = 'post'
    config.url = `${(config.url || '').replace(/\/+$/, '')}/delete`
    config.data = config.data ?? {}
  }
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('radnas_token')
      if (location.pathname !== '/login') location.href = '/login'
    }
    return Promise.reject(err)
  },
)
