export class AdvancedSearchService {
  /**
   * Generate Google dork queries for person search
   */
  generatePersonDorks(name: string, options?: {
    location?: string;
    department?: string;
    badge?: string;
  }): string[] {
    const dorks: string[] = [];
    const escapedName = `"${name}"`;

    // Government records
    dorks.push(`${escapedName} site:*.gov filetype:pdf`);
    dorks.push(`${escapedName} site:*.gov inurl:roster`);
    dorks.push(`${escapedName} site:*.gov inurl:personnel`);
    
    // Law enforcement specific
    if (options?.department) {
      dorks.push(`${escapedName} "${options.department}" site:*.gov`);
      dorks.push(`${escapedName} "${options.department}" inurl:officer`);
    }
    
    if (options?.badge) {
      dorks.push(`"badge ${options.badge}" ${escapedName}`);
      dorks.push(`"badge number ${options.badge}"`);
    }

    // Public records databases
    dorks.push(`${escapedName} site:transparencyusa.org`);
    dorks.push(`${escapedName} site:openpayrolls.com`);
    dorks.push(`${escapedName} site:publicpay.ca.gov`);
    dorks.push(`${escapedName} site:govsalaries.com`);

    // Court records
    dorks.push(`${escapedName} site:*.gov filetype:pdf "court"`);
    dorks.push(`${escapedName} site:*.gov inurl:case`);
    dorks.push(`${escapedName} site:pacer.gov`);

    // News and media
    dorks.push(`${escapedName} site:*.com inurl:news`);
    dorks.push(`${escapedName} "police" OR "officer" -site:facebook.com -site:twitter.com`);

    // Social media (professional)
    dorks.push(`${escapedName} site:linkedin.com "law enforcement"`);
    dorks.push(`${escapedName} site:linkedin.com "${options?.department || 'police'}"`);

    // Property records
    if (options?.location) {
      dorks.push(`${escapedName} "${options.location}" site:*.gov inurl:property`);
      dorks.push(`${escapedName} "${options.location}" site:zillow.com`);
    }

    // Professional licenses
    dorks.push(`${escapedName} site:*.gov inurl:license`);
    dorks.push(`${escapedName} site:*.gov "professional license"`);

    // Complaint records
    dorks.push(`${escapedName} site:*.gov "complaint" filetype:pdf`);
    dorks.push(`${escapedName} "internal affairs" OR "IA" filetype:pdf`);

    return dorks;
  }

  /**
   * Generate department-specific dorks
   */
  generateDepartmentDorks(department: string): string[] {
    return [
      `site:*.gov "${department}" inurl:roster`,
      `site:*.gov "${department}" filetype:pdf personnel`,
      `"${department}" site:transparencyusa.org`,
      `"${department}" site:openpayrolls.com`,
      `"${department}" inurl:budget filetype:pdf`,
      `"${department}" "organizational chart" filetype:pdf`,
    ];
  }

  /**
   * Build advanced search query with multiple operators
   */
  buildQuery(params: {
    keywords: string[];
    site?: string;
    filetype?: string;
    inurl?: string;
    intitle?: string;
    exclude?: string[];
    dateAfter?: string;
    dateBefore?: string;
  }): string {
    const parts: string[] = [];

    // Keywords (exact phrase if multiple words)
    params.keywords.forEach(keyword => {
      parts.push(keyword.includes(' ') ? `"${keyword}"` : keyword);
    });

    // Site restriction
    if (params.site) {
      parts.push(`site:${params.site}`);
    }

    // File type
    if (params.filetype) {
      parts.push(`filetype:${params.filetype}`);
    }

    // URL contains
    if (params.inurl) {
      parts.push(`inurl:${params.inurl}`);
    }

    // Title contains
    if (params.intitle) {
      parts.push(`intitle:"${params.intitle}"`);
    }

    // Exclusions
    if (params.exclude) {
      params.exclude.forEach(term => {
        parts.push(`-${term.includes(' ') ? `"${term}"` : term}`);
      });
    }

    // Date range
    if (params.dateAfter) {
      parts.push(`after:${params.dateAfter}`);
    }
    if (params.dateBefore) {
      parts.push(`before:${params.dateBefore}`);
    }

    return parts.join(' ');
  }

  /**
   * Common search patterns for OSINT
   */
  getSearchPatterns() {
    return {
      govRecords: 'site:*.gov filetype:pdf',
      courtDocs: 'site:*.gov inurl:court OR inurl:case',
      payroll: 'site:transparencyusa.org OR site:openpayrolls.com OR site:govsalaries.com',
      licenses: 'site:*.gov inurl:license OR inurl:certification',
      propertyRecords: 'site:*.gov inurl:property OR inurl:assessor',
      businessRecords: 'site:*.gov inurl:business OR inurl:corporation',
      voterRecords: 'site:*.gov inurl:voter OR inurl:election',
      arrestRecords: 'site:*.gov inurl:arrest OR inurl:booking filetype:pdf',
    };
  }
}

export const advancedSearch = new AdvancedSearchService();
