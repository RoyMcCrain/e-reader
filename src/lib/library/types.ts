export interface CloudBook {
	id: string
	name: string
	format: 'epub' | 'zip'
	size: number
	series?: string
	author?: string
	uploadedAt?: string
	hasCover?: boolean
}

export interface LibraryResponse {
	books: CloudBook[]
}
