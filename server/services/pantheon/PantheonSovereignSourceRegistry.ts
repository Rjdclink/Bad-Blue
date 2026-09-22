Warning: truncated output (original token count: 3963)
Total output lines: 291

import { admitPantheonUrl } from '../crawlers/PublicAcquisitionInfrastructure';
import { PANTHEON_VERIFIED_SOURCES_BATCH_01 } from './sources/batch01';
import { PANTHEON_VERIFIED_SOURCES_BATCH_02 } fr…3863 tokens truncated…ndRegistryTargets(subject:string, location?:string, perCategory=300) {
 return PANTHEON_BACKGROUND_CATEGORIES.flatMap(category=>buildPantheonCategoryTargets(category,subject,location,perCategory));
}
