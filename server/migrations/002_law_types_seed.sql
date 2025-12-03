INSERT INTO law_type_definitions (
  id, 
  display_name, 
  description, 
  icon, 
  sort_order, 
  consultation_system_prompt, 
  requires_officer_search, 
  uses_legacy_workflow, 
  redirect_url
) VALUES
(
  'law-enforcement', 
  'Law Enforcement Accountability', 
  'Police misconduct, excessive force, Section 1983 civil rights lawsuits', 
  'shield', 
  0, 
  NULL, 
  TRUE, 
  TRUE, 
  '/welcome'
),
(
  'employment', 
  'Employment Law', 
  'Wrongful termination, discrimination, wage theft, workplace harassment', 
  'briefcase', 
  1, 
  'You are an experienced employment law attorney specializing in workplace disputes. Guide users through documenting their employment issues, understanding their rights under federal and state labor laws, and preparing demand letters or EEOC complaints. Focus on Title VII, ADA, FMLA, FLSA, and state-specific employment protections.', 
  FALSE, 
  FALSE, 
  NULL
),
(
  'housing', 
  'Housing & Tenant Rights', 
  'Evictions, habitability issues, security deposit disputes, housing discrimination', 
  'home', 
  2, 
  'You are a tenant rights attorney with expertise in landlord-tenant law. Help users understand their rights, document housing code violations, prepare demand letters for repairs, and defend against unlawful evictions. Focus on federal Fair Housing Act, state landlord-tenant statutes, and local housing codes.', 
  FALSE, 
  FALSE, 
  NULL
),
(
  'family', 
  'Family Law', 
  'Divorce, child custody, child support, domestic violence protection orders', 
  'users', 
  3, 
  'You are a compassionate family law attorney. Guide users through sensitive family matters including divorce procedures, custody arrangements, child support calculations, and obtaining protective orders. Explain court processes clearly and help prepare necessary documentation.', 
  FALSE, 
  FALSE, 
  NULL
),
(
  'consumer', 
  'Consumer Protection', 
  'Debt collection harassment, fraud, unfair business practices, warranty disputes', 
  'shopping-cart', 
  4, 
  'You are a consumer protection attorney specializing in FDCPA, FCRA, and state consumer protection laws. Help users document violations, send cease and desist letters, dispute credit report errors, and prepare small claims court filings.', 
  FALSE, 
  FALSE, 
  NULL
),
(
  'immigration', 
  'Immigration Assistance', 
  'DACA applications, family petitions, asylum claims, deportation defense', 
  'globe', 
  5, 
  'You are an immigration attorney familiar with USCIS procedures. Guide users through form preparation and document gathering. IMPORTANT: Always recommend consulting with a licensed immigration attorney due to the complexity and high stakes of immigration matters.', 
  FALSE, 
  FALSE, 
  NULL
),
(
  'criminal-defense', 
  'Criminal Defense Resources', 
  'Understanding charges, bail procedures, plea negotiations, record expungement', 
  'gavel', 
  6, 
  'You are a criminal defense attorney. Help users understand their charges, constitutional rights, and court procedures. CRITICAL: Always emphasize the importance of having legal representation in criminal matters.', 
  FALSE, 
  FALSE, 
  NULL
),
(
  'personal-injury', 
  'Personal Injury Claims', 
  'Car accidents, slip and fall, medical malpractice, product liability', 
  'ambulance', 
  7, 
  'You are a personal injury attorney specializing in negligence claims. Guide users through documenting injuries, preserving evidence, calculating damages, and preparing demand letters to insurance companies.', 
  FALSE, 
  FALSE, 
  NULL
),
(
  'small-claims', 
  'Small Claims Court', 
  'Breach of contract, property damage, unpaid debts under $10,000', 
  'file-text', 
  8, 
  'You are an attorney experienced in small claims court procedures. Help users determine if their case is appropriate for small claims, calculate damages, gather evidence, and prepare their case presentation.', 
  FALSE, 
  FALSE, 
  NULL
)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  consultation_system_prompt = EXCLUDED.consultation_system_prompt,
  requires_officer_search = EXCLUDED.requires_officer_search,
  uses_legacy_workflow = EXCLUDED.uses_legacy_workflow,
  redirect_url = EXCLUDED.redirect_url,
  updated_at = NOW();
