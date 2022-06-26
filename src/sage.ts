import fs from "fs";
type JournalData = {
  status: string;
  date: string;
  narration: string;
  journalLines: {
    accountCoude: string;
    amount: number;
    description: string;
  }[];
};

export class Sage {
  private readonly endpoint = "https://oauth.accounting.sage.com";
  private readonly accountingEndpoint = "https://api.accounting.sage.com/v3.1";
  private readonly resultsPerPage = 200;

  private tokenFilePath: string;
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private token!: Record<string, any>;

  constructor(
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    tokenFilePath: string
  ) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.tokenFilePath = tokenFilePath;
  }

  private saveToken(): void {
    if (!this.token) {
      throw new Error(`Invalid token.`);
    }
    fs.writeFileSync(this.tokenFilePath, JSON.stringify(this.token));
  }

  async initClient(): Promise<void> {
    if (!this.clientId || !this.clientSecret || !this.redirectUri) {
      throw new Error(
        `Invalid environment variables. Please set SAGE_CLIENT_ID and SAGE_CLIENT_SECRET.`
      );
    }
    this.refreshToken();
  }

  public async getAccounts() {
    const response = await this.requestJson(
      `/ledger_accounts?items_per_page=${this.resultsPerPage}&attributes=all`
    );
    const promises: Promise<any>[] = [];
    const items = response.$items.map((i: any) => {
      return {
        id: i.id,
        name: i.name,
        code: i.nominal_code,
      };
    });
    const accounts = items;
    const pages = response.$total / this.resultsPerPage;

    for (let i = 1; i <= pages; i++) {
      promises.push(
        this.requestJson(
          `/ledger_accounts?items_per_page=${
            this.resultsPerPage
          }&attributes=all&page=${i + 1}`
        ).then((r: any) => {
          accounts.push(
            ...r.$items.map((i: any) => {
              return {
                id: i.id,
                name: i.name,
                code: i.nominal_code,
              };
            })
          );
        })
      );
    }

    await Promise.all(promises);
    return accounts;
  }

  async getConsentUrl(): Promise<string> {
    return `https://www.sageone.com/oauth2/auth/central?filter=apiv3.1&response_type=code&scope=full_access&redirect_uri=${this.redirectUri}&client_id=${this.clientId}`;
  }

  async processCallback(requestUrl: string): Promise<void> {
    const url = new URL(`http://localhost${requestUrl}`);
    const params = new URLSearchParams(url.search);
    const code = params.get("code");

    if (!code) {
      throw new Error(`Invalid code.`);
    }

    const response = await fetch(`${this.endpoint}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: code,
        grant_type: "authorization_code",
        redirect_uri: this.redirectUri,
      }),
    });

    if (!response.ok) {
      throw new Error(`Invalid response.`);
    }

    const json = await response.json();
    if (!json) {
      throw new Error(`Invalid json response.`);
    }

    this.token = json;
    this.saveToken();
  }

  private getToken() {
    if (!fs.existsSync(this.tokenFilePath)) {
      return false;
    }

    const token = fs.readFileSync(this.tokenFilePath);
    if (!token) {
      throw new Error(`Failed to retrieve token.`);
    }

    const tokencontents = JSON.parse(token.toString());
    if (!tokencontents?.access_token) {
      throw new Error(`Invalid access_token.`);
    }
    this.token = tokencontents;
    return true;
  }

  private async refreshToken(): Promise<void> {
    if (!this.getToken()) {
      return;
    }
    const response = await fetch(`${this.endpoint}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "refresh_token",
        refresh_token: this.token.refresh_token,
      }),
    });

    const json = await response.json();
    if (!json) {
      throw new Error(`Invalid json response.`);
    }

    this.token = json;
    this.saveToken();
  }

  private async requestJson(apiPath: string) {
    const response = await fetch(`${this.accountingEndpoint}${apiPath}`, {
      headers: {
        Authorization: `Bearer ${this.token.access_token}`,
      },
    });

    return await response.json();
  }

  private async postJson(apiPath: string, data: any) {
    return fetch(`${this.accountingEndpoint}${apiPath}`, {
      headers: {
        Authorization: `Bearer ${this.token.access_token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async createJournal(data: JournalData): Promise<any> {
    const postData = {
      journal: {
        date: data.date,
        reference: data.narration,
        journal_lines: data.journalLines.map((i: any) => {
          let debit = 0;
          let credit = 0;
          if (i.amount > 0) {
            credit = i.amount;
          } else if (i.amount < 0) {
            debit = Math.abs(i.amount);
          }

          return {
            details: i.description,
            debit: debit,
            credit: credit,
            ledger_account_id: i.accountCode,
          };
        }),
      },
    };
    const response = await this.postJson("/journals", postData);

    return response.json();
  }
}
