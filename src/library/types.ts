export interface CloudBook {
  id: string
  name: string
  format: 'epub' | 'zip'
  size: number
}

export interface LibraryResponse {
  books: CloudBook[]
}
