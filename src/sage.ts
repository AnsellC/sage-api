import fs from 'fs'

export class Sage {
    private readonly endpoint = 'https://oauth.accounting.sage.com'
    private readonly accountingEndpoint = 'https://api.accounting.sage.com/v3.1'
    private readonly resultsPerPage = 200

    private clientId: string
    private clientSecret: string
    private redirectUri: string
    private token!: TokenData

    constructor(clientId: string, clientSecret: string, redirectUri: string, tokenData?: TokenData) {
        this.clientId = clientId
        this.clientSecret = clientSecret
        this.redirectUri = redirectUri
        if (tokenData) {
            if (!this.isValidToken(tokenData)) {
                throw new Error(`Invalid token data.`)
            }

            this.token = tokenData
        }
    }

    private isValidToken(tokenData: TokenData): boolean {
        const keys = Object.keys(tokenData)
        if (!keys.includes('access_token') || !keys.includes('refresh_token')) {
            return false
        }
        return true
    }

    public async getAccounts() {
        const response = await this.requestJson(`/ledger_accounts?items_per_page=${this.resultsPerPage}&attributes=all`)
        const promises: Promise<any>[] = []
        const items = response.$items.map((i: any) => {
            return {
                id: i.id,
                name: i.name,
                code: i.nominal_code,
                type: i.ledger_account_type.id,
            }
        })
        const accounts = items
        const pages = response.$total / this.resultsPerPage

        for (let i = 1; i <= pages; i++) {
            promises.push(
                this.requestJson(`/ledger_accounts?items_per_page=${this.resultsPerPage}&attributes=all&page=${i + 1}`).then((r: any) => {
                    accounts.push(
                        ...r.$items.map((i: any) => {
                            return {
                                id: i.id,
                                name: i.name,
                                code: i.nominal_code,
                                type: i.ledger_account_type.id,
                            }
                        })
                    )
                })
            )
        }

        await Promise.all(promises)
        return accounts
    }

    async getConsentUrl(): Promise<string> {
        return `https://www.sageone.com/oauth2/auth/central?filter=apiv3.1&response_type=code&scope=full_access&redirect_uri=${this.redirectUri}&client_id=${this.clientId}`
    }

    async processCallback(code: string): Promise<TokenData> {
        if (!code) {
            throw new Error(`Invalid code.`)
        }

        const response = await fetch(`${this.endpoint}/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            },
            body: new URLSearchParams({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                code: code,
                grant_type: 'authorization_code',
                redirect_uri: this.redirectUri,
            }),
        })

        if (!response.ok) {
            throw new Error(`Invalid response. ${response.status}.`)
        }

        const json = await response.json()
        if (!json) {
            throw new Error(`Invalid json response.`)
        }

        return json
    }

    async refreshToken(): Promise<TokenData> {
        if (!this.token) {
            throw new Error(`Invalid empty token.`)
        }
        const response = await fetch(`${this.endpoint}/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            },
            body: new URLSearchParams({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                grant_type: 'refresh_token',
                refresh_token: this.token.refresh_token,
            }),
        })

        const json = await response.json()
        if (!json) {
            throw new Error(`Invalid json response.`)
        }

        this.token = json
        return this.token
    }

    private async requestJson(apiPath: string) {
        const response = await fetch(`${this.accountingEndpoint}${apiPath}`, {
            headers: {
                Authorization: `Bearer ${this.token.access_token}`,
            },
        })

        return response.json()
    }

    private async postJson(apiPath: string, data: any) {
        return fetch(`${this.accountingEndpoint}${apiPath}`, {
            headers: {
                Authorization: `Bearer ${this.token.access_token}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            method: 'POST',
            body: JSON.stringify(data),
        })
    }

    async createJournal(data: JournalData): Promise<any> {
        const postData = {
            journal: {
                date: data.date,
                reference: data.narration,
                journal_lines: data.journalLines.map((i: any) => {
                    let debit = 0
                    let credit = 0
                    if (i.amount > 0) {
                        credit = i.amount
                    } else if (i.amount < 0) {
                        debit = Math.abs(i.amount)
                    }

                    return {
                        details: i.description,
                        debit: debit,
                        credit: credit,
                        ledger_account_id: i.accountCode,
                    }
                }),
            },
        }
        const response = await this.postJson('/journals', postData)

        return response.json()
    }
}
