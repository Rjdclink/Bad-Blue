import { advancedSearch } from './advancedSearch';

export class SearchQueryBuilder {
  private params: {
    keywords: string[];
    site?: string;
    filetype?: string;
    inurl?: string;
    intitle?: string;
    exclude?: string[];
    dateAfter?: string;
    dateBefore?: string;
  } = { keywords: [] };

  keyword(keyword: string): this {
    this.params.keywords.push(keyword);
    return this;
  }

  site(domain: string): this {
    this.params.site = domain;
    return this;
  }

  fileType(type: string): this {
    this.params.filetype = type;
    return this;
  }

  inUrl(term: string): this {
    this.params.inurl = term;
    return this;
  }

  inTitle(term: string): this {
    this.params.intitle = term;
    return this;
  }

  exclude(term: string): this {
    if (!this.params.exclude) this.params.exclude = [];
    this.params.exclude.push(term);
    return this;
  }

  after(date: string): this {
    this.params.dateAfter = date;
    return this;
  }

  before(date: string): this {
    this.params.dateBefore = date;
    return this;
  }

  build(): string {
    return advancedSearch.buildQuery(this.params);
  }

  reset(): this {
    this.params = { keywords: [] };
    return this;
  }
}

export const queryBuilder = new SearchQueryBuilder();
