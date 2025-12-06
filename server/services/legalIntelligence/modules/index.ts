/**
 * Legal Intelligence Modules
 * SpiderFoot-style plugin modules for data enrichment
 */

import type { LegalIntelligenceModule } from '../types';

// Module registry
const modules: Map<string, LegalIntelligenceModule> = new Map();

/**
 * Register a module
 */
export function registerModule(module: LegalIntelligenceModule): void {
  modules.set(module.name, module);
}

/**
 * Get all registered modules
 */
export function getAllModules(): LegalIntelligenceModule[] {
  return Array.from(modules.values());
}

/**
 * Get module by name
 */
export function getModule(name: string): LegalIntelligenceModule | undefined {
  return modules.get(name);
}

/**
 * Get modules that handle a specific input type
 */
export function getModulesByInputType(inputType: string): LegalIntelligenceModule[] {
  return Array.from(modules.values()).filter(m => m.inputTypes.includes(inputType));
}

// Export individual modules
export * from './publicRecordsModule';
export * from './courtDocketModule';
export * from './newsMentionsModule';
export * from './socialMediaModule';
export * from './breachDataModule';
export * from './corporateModule';
export * from './licensingModule';
export * from './arrestRecordsModule';
