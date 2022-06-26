type JournalData = {
    status: string
    date: string
    narration: string
    journalLines: {
        accountCoude: string
        amount: number
        description: string
    }[]
}

type TokenData = {
    scope: string
    expires_in: number
    token_type: string
    access_token: string
    refresh_token: string
    refresh_token_expires_in: number
    request_by_id: string
}
