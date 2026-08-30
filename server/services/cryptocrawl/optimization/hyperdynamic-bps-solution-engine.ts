export type BpsSolutionCategory =
  | 'edge_preservation'
  | 'fee_rebate_compression'
  | 'maker_hybrid_recovery'
  | 'size_liquidity_optimization'
  | 'compute_antenna_allocation'
  | 'venue_pair_selection'
  | 'zero_capital_gas_efficiency'
  | 'cross_topology_composition'
  | 'monte_carlo_risk_calibration'
  | 'runtime_evidence_resilience';

export type BpsMetric =
  | 'closestFeeGapBps'
  | 'closestRiskGapBps'
  | 'positiveModes'
  | 'feeFreshnessShare'
  | 'staleFeeModes'
  | 'hybridNearMissShare'
  | 'bestRecoveryEfficiency'
  | 'makerSavingsBps'
  | 'lowestCombinedFeeBps'
  | 'bestGrossSpreadBps'
  | 'observedModes'
  | 'withinFiveBps'
  | 'withinTenBps'
  | 'medianGapBps'
  | 'p90GapBps'
  | 'rpiSavingsBps'
  | 'rpiEligibleSymbols'
  | 'providerQuality'
  | 'heatPressure'
  | 'zeroCapitalGapBps'
  | 'zeroCapitalPositiveYield'
  | 'zeroCapitalQuoteUtilization'
  | 'relativeCexAdvantageBps';

export type BpsLever =
  | 'cexPriority'
  | 'zeroCapitalPriority'
  | 'breadth'
  | 'cadence'
  | 'recoveryQuota'
  | 'hybridQuota'
  | 'feeRefresh'
  | 'makerFocus'
  | 'sizeRefinement'
  | 'quoteBudget'
  | 'mcSearch'
  | 'exploration'
  | 'stalePenalty'
  | 'liquidityFocus'
  | 'latencyFocus'
  | 'venueDiversity'
  | 'evidenceRefresh'
  | 'gasSensitivity'
  | 'switchHysteresis'
  | 'riskBuffer';

export interface HyperdynamicBpsInput {
  closestFeeGapBps?: number | null;
  closestRiskGapBps?: number | null;
  positiveModes?: number | null;
  feeFreshnessShare?: number | null;
  staleFeeModes?: number | null;
  hybridNearMissShare?: number | null;
  bestRecoveryEfficiency?: number | null;
  makerSavingsBps?: number | null;
  lowestCombinedFeeBps?: number | null;
  bestGrossSpreadBps?: number | null;
  observedModes?: number | null;
  withinFiveBps?: number | null;
  withinTenBps?: number | null;
  medianGapBps?: number | null;
  p90GapBps?: number | null;
  rpiSavingsBps?: number | null;
  rpiEligibleSymbols?: number | null;
  providerQuality?: number | null;
  heatPressure?: number | null;
  zeroCapitalGapBps?: number | null;
  zeroCapitalPositiveYield?: number | null;
  zeroCapitalQuoteUtilization?: number | null;
  relativeCexAdvantageBps?: number | null;
}

export interface BpsSolutionDefinition {
  id: number;
  key: string;
  category: BpsSolutionCategory;
  name: string;
  metric: BpsMetric;
  direction: 'lte' | 'gte';
  threshold: number;
  lever: BpsLever;
  factor: number;
  intent: string;
}

function s(
  id: number,
  category: BpsSolutionCategory,
  key: string,
  name: string,
  metric: BpsMetric,
  direction: 'lte' | 'gte',
  threshold: number,
  lever: BpsLever,
  factor: number,
  intent: string,
): BpsSolutionDefinition {
  return { id, category, key, name, metric, direction, threshold, lever, factor, intent };
}

export const HYPERDYNAMIC_BPS_SOLUTIONS: readonly BpsSolutionDefinition[] = [
  // 1-10: deterministic edge preservation
  s(1,'edge_preservation','micro_gap_burst','Sub-2-BPS burst cadence','closestFeeGapBps','lte',2,'cadence',0.58,'Recheck near-positive evidence before the spread decays.'),
  s(2,'edge_preservation','near_gap_breadth','Sub-5-BPS recovery breadth','closestFeeGapBps','lte',5,'breadth',1.18,'Keep adjacent symbols and venues warm around a near-positive condition.'),
  s(3,'edge_preservation','risk_gap_priority','Sub-5-BPS risk-adjusted priority','closestRiskGapBps','lte',5,'cexPriority',1.28,'Prefer the topology closest to positive after measured uncertainty.'),
  s(4,'edge_preservation','positive_hold','Positive-mode hold priority','positiveModes','gte',1,'cexPriority',1.45,'Keep compute on an already positive measured mode until canonical revalidation finishes.'),
  s(5,'edge_preservation','five_bps_quota','Five-BPS recovery quota','withinFiveBps','gte',1,'recoveryQuota',1.24,'Reserve more recovery slots for symbols within five BPS.'),
  s(6,'edge_preservation','ten_bps_cluster','Ten-BPS cluster retention','withinTenBps','gte',2,'recoveryQuota',1.14,'Retain a cluster of near-break-even symbols instead of chasing one transient leader.'),
  s(7,'edge_preservation','evidence_loss_reset','Evidence-loss breadth reset','observedModes','lte',4,'breadth',1.20,'Restore search breadth when measured modes disappear.'),
  s(8,'edge_preservation','positive_fee_refresh','Positive-mode fee refresh','positiveModes','gte',1,'feeRefresh',0.45,'Shorten authenticated fee evidence age when a positive mode exists.'),
  s(9,'edge_preservation','micro_gap_hysteresis','Micro-gap topology hysteresis','closestFeeGapBps','lte',1.5,'switchHysteresis',1.35,'Avoid abandoning a topology that is effectively at the barrier.'),
  s(10,'edge_preservation','high_recovery_priority','High recovery-efficiency retention','bestRecoveryEfficiency','gte',0.70,'cexPriority',1.14,'Favor conditions already recovering most of their fee burden.'),

  // 11-20: fees, rebates and authenticated fee freshness
  s(11,'fee_rebate_compression','rpi_savings_focus','RPI savings focus','rpiSavingsBps','gte',1,'makerFocus',1.22,'Increase maker research when authenticated RPI economics can save BPS.'),
  s(12,'fee_rebate_compression','rpi_symbol_priority','RPI-eligible symbol priority','rpiEligibleSymbols','gte',1,'cexPriority',1.08,'Keep fee-advantaged OKX symbols in the measured search surface.'),
  s(13,'fee_rebate_compression','low_fee_lane','Low-fee lane priority','lowestCombinedFeeBps','lte',5,'cexPriority',1.16,'Prefer venues and pairs with structurally low authenticated fees.'),
  s(14,'fee_rebate_compression','maker_savings_focus','Maker savings focus','makerSavingsBps','gte',5,'makerFocus',1.20,'Expand passive-mode analysis when maker savings are meaningful.'),
  s(15,'fee_rebate_compression','large_maker_savings','Large maker savings recovery','makerSavingsBps','gte',20,'recoveryQuota',1.16,'Reserve more recovery capacity when maker conversion can remove a large fee barrier.'),
  s(16,'fee_rebate_compression','freshness_refresh','Freshness deficit refresh','feeFreshnessShare','lte',0.90,'feeRefresh',0.62,'Refresh authenticated fees aggressively when freshness deteriorates.'),
  s(17,'fee_rebate_compression','stale_fee_refresh','Stale fee eviction','staleFeeModes','gte',1,'feeRefresh',0.52,'Reduce cache age whenever stale fee evidence is present.'),
  s(18,'fee_rebate_compression','low_fee_diversity','Low-fee venue diversity','lowestCombinedFeeBps','lte',20,'venueDiversity',1.12,'Search alternate venue combinations around low-fee products.'),
  s(19,'fee_rebate_compression','spread_fee_conversion','Large spread maker conversion','bestGrossSpreadBps','gte',10,'makerFocus',1.10,'Test maker conversion when observed spread can plausibly absorb execution uncertainty.'),
  s(20,'fee_rebate_compression','median_gap_fee_refresh','Median-gap evidence refresh','medianGapBps','lte',25,'evidenceRefresh',1.15,'Keep fee and product evidence current when the broader surface is approaching profitability.'),

  // 21-30: maker/taker and hybrid recovery
  s(21,'maker_hybrid_recovery','hybrid_share_boost','Hybrid near-miss boost','hybridNearMissShare','gte',0.30,'hybridQuota',1.22,'Allocate more analysis to MT/TM when hybrid modes dominate near misses.'),
  s(22,'maker_hybrid_recovery','hybrid_majority_boost','Hybrid-majority boost','hybridNearMissShare','gte',0.50,'hybridQuota',1.14,'Increase hybrid recovery depth when half the near misses are MT/TM.'),
  s(23,'maker_hybrid_recovery','recovery_size_probe','Recovery-aware size probe','bestRecoveryEfficiency','gte',0.30,'sizeRefinement',1.16,'Search smaller and deeper size points when recovery efficiency is promising.'),
  s(24,'maker_hybrid_recovery','maker_size_probe','Maker-savings size probe','makerSavingsBps','gte',10,'sizeRefinement',1.14,'Refine quantity where maker savings can change the sign of net BPS.'),
  s(25,'maker_hybrid_recovery','near_gap_maker_focus','Near-gap maker focus','closestFeeGapBps','lte',10,'makerFocus',1.18,'Test passive legs more deeply when only a small fee gap remains.'),
  s(26,'maker_hybrid_recovery','wide_spread_passive','Wide-spread passive focus','bestGrossSpreadBps','gte',15,'makerFocus',1.10,'Prefer maker recovery where observed spread is wide enough to reward patience.'),
  s(27,'maker_hybrid_recovery','risk_gap_hybrid','Risk-adjusted hybrid focus','closestRiskGapBps','lte',15,'hybridQuota',1.12,'Increase MT/TM analysis only when measured uncertainty remains bounded.'),
  s(28,'maker_hybrid_recovery','fresh_hybrid','Fresh hybrid priority','feeFreshnessShare','gte',0.95,'hybridQuota',1.08,'Favor hybrid modes backed by fresh authenticated fees.'),
  s(29,'maker_hybrid_recovery','maker_liquidity_focus','Maker liquidity focus','makerSavingsBps','gte',5,'liquidityFocus',1.12,'Spend depth analysis where passive fills could remove fee BPS.'),
  s(30,'maker_hybrid_recovery','maker_latency_focus','Maker queue latency focus','hybridNearMissShare','gte',0.40,'latencyFocus',1.12,'Increase queue/latency measurement when hybrid opportunity density is high.'),

  // 31-40: sizing, depth and liquidity
  s(31,'size_liquidity_optimization','high_efficiency_sizing','High-efficiency size refinement','bestRecoveryEfficiency','gte',0.50,'sizeRefinement',1.20,'Probe quantity around efficient near-break-even modes.'),
  s(32,'size_liquidity_optimization','micro_gap_sizing','Micro-gap size refinement','closestFeeGapBps','lte',5,'sizeRefinement',1.18,'Search for the size where depth-weighted spread crosses zero.'),
  s(33,'size_liquidity_optimization','risk_bounded_liquidity','Risk-bounded liquidity focus','closestRiskGapBps','lte',10,'liquidityFocus',1.18,'Spend depth work on candidates whose residual risk gap is small.'),
  s(34,'size_liquidity_optimization','wide_spread_depth','Wide-spread depth expansion','bestGrossSpreadBps','gte',20,'liquidityFocus',1.15,'Validate deeper executable quantity when gross edge is large.'),
  s(35,'size_liquidity_optimization','low_fee_size_search','Low-fee size search','lowestCombinedFeeBps','lte',10,'sizeRefinement',1.12,'Use extra size points on low-fee lanes where small depth changes matter.'),
  s(36,'size_liquidity_optimization','cluster_liquidity','Near-miss cluster liquidity','withinTenBps','gte',3,'liquidityFocus',1.10,'Measure depth across several near-positive symbols to avoid concentration.'),
  s(37,'size_liquidity_optimization','median_gap_sizing','Median-gap size search','medianGapBps','lte',20,'sizeRefinement',1.10,'Increase size-grid resolution when the whole measured surface improves.'),
  s(38,'size_liquidity_optimization','tail_gap_guard','Tail-gap compute guard','p90GapBps','gte',100,'sizeRefinement',0.88,'Avoid wasting deep size work on a very poor tail of opportunities.'),
  s(39,'size_liquidity_optimization','positive_depth_hold','Positive depth hold','positiveModes','gte',1,'liquidityFocus',1.22,'Immediately deepen executable-depth checks around positive observations.'),
  s(40,'size_liquidity_optimization','fresh_depth_probe','Fresh-evidence depth probe','feeFreshnessShare','gte',0.98,'liquidityFocus',1.08,'Prefer depth refinement when fees are current enough to make the result meaningful.'),

  // 41-50: Computational Reactor and Antenna allocation
  s(41,'compute_antenna_allocation','positive_mc_burst','Positive-mode MC burst','positiveModes','gte',1,'mcSearch',1.24,'Use more bounded simulation around already-positive observations.'),
  s(42,'compute_antenna_allocation','near_gap_mc','Near-gap MC refinement','closestRiskGapBps','lte',10,'mcSearch',1.16,'Use simulation to replace coarse uncertainty with measured distributions.'),
  s(43,'compute_antenna_allocation','provider_quality_breadth','High-quality provider breadth','providerQuality','gte',0.75,'breadth',1.12,'Exploit broader search when market-data providers are healthy.'),
  s(44,'compute_antenna_allocation','low_quality_refresh','Low-quality provider refresh','providerQuality','lte',0.45,'evidenceRefresh',1.20,'Prioritize fresh evidence instead of stale inference when provider quality falls.'),
  s(45,'compute_antenna_allocation','heat_breadth_guard','High-heat breadth guard','heatPressure','gte',0.80,'breadth',0.82,'Reduce redundant breadth under computational pressure.'),
  s(46,'compute_antenna_allocation','heat_cadence_guard','High-heat cadence guard','heatPressure','gte',0.90,'cadence',1.18,'Back off low-value cadence during severe resource pressure.'),
  s(47,'compute_antenna_allocation','healthy_fast_lane','Healthy fast lane','heatPressure','lte',0.40,'cadence',0.90,'Use available compute to shorten evidence-to-requote time.'),
  s(48,'compute_antenna_allocation','dense_mode_mc','Dense-mode MC allocation','observedModes','gte',40,'mcSearch',1.10,'Spend simulation where the measured surface is information-rich.'),
  s(49,'compute_antenna_allocation','sparse_mode_reset','Sparse-mode exploration reset','observedModes','lte',8,'exploration',1.12,'Increase exploration when narrow search loses the market surface.'),
  s(50,'compute_antenna_allocation','near_gap_latency','Near-gap latency focus','closestFeeGapBps','lte',5,'latencyFocus',1.18,'Measure and reduce stale-edge loss when the economic gap is tiny.'),

  // 51-60: venue and pair selection
  s(51,'venue_pair_selection','low_fee_venue_expansion','Low-fee venue expansion','lowestCombinedFeeBps','lte',10,'venueDiversity',1.20,'Search more venue combinations around structurally cheap products.'),
  s(52,'venue_pair_selection','maker_venue_expansion','Maker-friendly venue expansion','makerSavingsBps','gte',10,'venueDiversity',1.15,'Preserve alternatives where passive fees materially differ.'),
  s(53,'venue_pair_selection','rpi_venue_expansion','RPI venue expansion','rpiEligibleSymbols','gte',1,'venueDiversity',1.12,'Keep RPI-eligible market structures represented in discovery.'),
  s(54,'venue_pair_selection','fresh_venue_preference','Fresh venue preference','feeFreshnessShare','gte',0.95,'venueDiversity',1.06,'Allow more venue diversity when fee evidence is consistently fresh.'),
  s(55,'venue_pair_selection','stale_venue_contraction','Stale venue contraction','staleFeeModes','gte',5,'venueDiversity',0.86,'Temporarily contract unreliable venue combinations until evidence refreshes.'),
  s(56,'venue_pair_selection','gross_edge_venue_search','Gross-edge venue search','bestGrossSpreadBps','gte',20,'venueDiversity',1.12,'Look for alternate venues that retain a large gross edge with lower fees.'),
  s(57,'venue_pair_selection','near_gap_venue_search','Near-gap venue search','closestFeeGapBps','lte',10,'venueDiversity',1.10,'Search alternative venue pairings when only a small reduction is needed.'),
  s(58,'venue_pair_selection','cluster_venue_search','Cluster venue diversification','withinTenBps','gte',2,'venueDiversity',1.08,'Diversify near-break-even symbols across execution venues.'),
  s(59,'venue_pair_selection','poor_tail_venue_guard','Poor-tail venue guard','p90GapBps','gte',120,'venueDiversity',0.92,'Stop broad venue expansion when the long tail is economically hopeless.'),
  s(60,'venue_pair_selection','positive_venue_hold','Positive venue hold','positiveModes','gte',1,'switchHysteresis',1.24,'Hold the venue topology long enough for canonical confirmation.'),

  // 61-70: zero-capital, DEX and gas efficiency
  s(61,'zero_capital_gas_efficiency','zero_near_gap_priority','Zero-capital near-gap priority','zeroCapitalGapBps','lte',25,'zeroCapitalPriority',1.28,'Increase exact quoting only when zero-capital economics approach viability.'),
  s(62,'zero_capital_gas_efficiency','zero_medium_gap_priority','Zero-capital medium-gap priority','zeroCapitalGapBps','lte',50,'zeroCapitalPriority',1.14,'Retain measured DEX routes that are improving toward break-even.'),
  s(63,'zero_capital_gas_efficiency','zero_far_gap_guard','Zero-capital far-gap guard','zeroCapitalGapBps','gte',75,'zeroCapitalPriority',0.82,'Reduce expensive quoting when the route is far from profitability.'),
  s(64,'zero_capital_gas_efficiency','zero_quote_yield','Zero-capital quote-yield expansion','zeroCapitalQuoteUtilization','gte',0.50,'quoteBudget',1.20,'Expand exact quote budget when selected routes frequently return measurements.'),
  s(65,'zero_capital_gas_efficiency','zero_low_quote_yield','Zero-capital low-yield guard','zeroCapitalQuoteUtilization','lte',0.05,'quoteBudget',0.78,'Avoid wasting RPC work when selected routes rarely return usable quotes.'),
  s(66,'zero_capital_gas_efficiency','zero_positive_yield','Zero-capital positive-yield expansion','zeroCapitalPositiveYield','gte',0.01,'quoteBudget',1.30,'Scale quote budget when deterministic positive quotes begin appearing.'),
  s(67,'zero_capital_gas_efficiency','zero_positive_priority','Zero-capital positive priority','zeroCapitalPositiveYield','gte',0.01,'zeroCapitalPriority',1.35,'Shift attention toward an actually productive zero-capital surface.'),
  s(68,'zero_capital_gas_efficiency','zero_far_gap_gas_sensitivity','Far-gap gas sensitivity','zeroCapitalGapBps','gte',60,'gasSensitivity',1.22,'Demand stronger gas economics from routes far below break-even.'),
  s(69,'zero_capital_gas_efficiency','zero_near_gap_gas_probe','Near-gap gas probe','zeroCapitalGapBps','lte',20,'gasSensitivity',0.86,'Allow more gas-route exploration when only a small gap remains.'),
  s(70,'zero_capital_gas_efficiency','zero_exploration_floor','Zero-capital exploration floor','zeroCapitalQuoteUtilization','lte',0.20,'exploration',1.08,'Keep a bounded exploration floor so new routes can replace stale ones.'),

  // 71-80: cross-topology composition and switching
  s(71,'cross_topology_composition','cex_advantage_priority','CEX relative-gap advantage','relativeCexAdvantageBps','gte',20,'cexPriority',1.24,'Prefer CEX when it is materially closer to positive BPS than zero-capital.'),
  s(72,'cross_topology_composition','cex_large_advantage','Large CEX relative advantage','relativeCexAdvantageBps','gte',50,'cexPriority',1.16,'Concentrate scarce compute on the materially stronger topology.'),
  s(73,'cross_topology_composition','zero_advantage_priority','Zero-capital relative advantage','relativeCexAdvantageBps','lte',-20,'zeroCapitalPriority',1.24,'Shift attention when zero-capital is clearly closer to positive economics.'),
  s(74,'cross_topology_composition','balanced_topology_exploration','Balanced-topology exploration','relativeCexAdvantageBps','lte',10,'exploration',1.06,'Preserve exploration when topology economics are close.'),
  s(75,'cross_topology_composition','cex_micro_gap_lock','CEX micro-gap lock','closestFeeGapBps','lte',2,'switchHysteresis',1.30,'Prevent oscillation away from a nearly profitable CEX condition.'),
  s(76,'cross_topology_composition','zero_micro_gap_lock','Zero-capital micro-gap lock','zeroCapitalGapBps','lte',10,'switchHysteresis',1.16,'Retain DEX attention when exact quotes are genuinely near break-even.'),
  s(77,'cross_topology_composition','positive_topology_lock','Positive topology lock','positiveModes','gte',1,'switchHysteresis',1.35,'Keep resources on measured positive evidence through canonical confirmation.'),
  s(78,'cross_topology_composition','weak_surface_exploration','Weak-surface exploration','medianGapBps','gte',75,'exploration',1.12,'Search for a different market regime when the current CEX surface is poor.'),
  s(79,'cross_topology_composition','near_surface_exploitation','Near-surface exploitation','medianGapBps','lte',25,'exploration',0.92,'Use more exploitation when broad CEX economics improve.'),
  s(80,'cross_topology_composition','dual_near_gap_compute','Dual-near-gap compute','closestRiskGapBps','lte',15,'mcSearch',1.10,'Use MC to compare competing near-positive paths on common uncertainty terms.'),

  // 81-90: Monte Carlo and risk calibration
  s(81,'monte_carlo_risk_calibration','mc_micro_gap','Micro-gap MC calibration','closestRiskGapBps','lte',5,'mcSearch',1.24,'Increase simulations where uncertainty can decide whether a small residual gap is real.'),
  s(82,'monte_carlo_risk_calibration','mc_near_gap','Near-gap MC calibration','closestRiskGapBps','lte',15,'mcSearch',1.12,'Refine slippage/latency distributions instead of applying broad penalties.'),
  s(83,'monte_carlo_risk_calibration','fresh_risk_buffer','Fresh-evidence risk compression','feeFreshnessShare','gte',0.98,'riskBuffer',0.90,'Permit a smaller uncertainty multiplier only when evidence is very fresh.'),
  s(84,'monte_carlo_risk_calibration','stale_risk_buffer','Stale-evidence risk expansion','feeFreshnessShare','lte',0.80,'riskBuffer',1.16,'Increase uncertainty when authenticated evidence becomes stale.'),
  s(85,'monte_carlo_risk_calibration','provider_risk_compression','High-quality provider risk compression','providerQuality','gte',0.85,'riskBuffer',0.92,'Use measured provider reliability to reduce generic uncertainty.'),
  s(86,'monte_carlo_risk_calibration','provider_risk_expansion','Low-quality provider risk expansion','providerQuality','lte',0.40,'riskBuffer',1.15,'Demand more margin when the data surface is unreliable.'),
  s(87,'monte_carlo_risk_calibration','positive_mc_confirmation','Positive MC confirmation','positiveModes','gte',1,'mcSearch',1.18,'Spend simulation on confirming rather than discovering a positive edge.'),
  s(88,'monte_carlo_risk_calibration','hybrid_mc','Hybrid fill MC','hybridNearMissShare','gte',0.40,'mcSearch',1.12,'Model maker-fill and taker-hedge timing when hybrids dominate.'),
  s(89,'monte_carlo_risk_calibration','high_efficiency_mc','High-efficiency MC','bestRecoveryEfficiency','gte',0.60,'mcSearch',1.10,'Refine candidates already recovering most of their cost barrier.'),
  s(90,'monte_carlo_risk_calibration','tail_mc_guard','Poor-tail MC guard','p90GapBps','gte',150,'mcSearch',0.84,'Do not spend simulation budget on a deeply negative tail.'),

  // 91-100: runtime, evidence and resilience
  s(91,'runtime_evidence_resilience','stale_evidence_refresh','Stale-evidence refresh burst','staleFeeModes','gte',1,'evidenceRefresh',1.25,'Restore decision quality immediately when fee evidence goes stale.'),
  s(92,'runtime_evidence_resilience','freshness_cadence','Freshness-protecting cadence','feeFreshnessShare','lte',0.90,'cadence',0.86,'Shorten scan intervals before evidence ages out.'),
  s(93,'runtime_evidence_resilience','provider_degradation_breadth','Provider-degradation breadth guard','providerQuality','lte',0.40,'breadth',0.82,'Avoid multiplying low-quality requests during provider degradation.'),
  s(94,'runtime_evidence_resilience','provider_recovery_breadth','Provider-recovery breadth','providerQuality','gte',0.80,'breadth',1.08,'Re-expand once provider quality recovers.'),
  s(95,'runtime_evidence_resilience','heat_evidence_focus','Heat evidence focus','heatPressure','gte',0.80,'evidenceRefresh',1.12,'Spend constrained compute on authoritative evidence rather than duplicate exploration.'),
  s(96,'runtime_evidence_resilience','heat_exploration_guard','Heat exploration guard','heatPressure','gte',0.90,'exploration',0.86,'Reduce nonessential exploration during severe compute pressure.'),
  s(97,'runtime_evidence_resilience','mode_loss_recovery','Mode-loss recovery','observedModes','lte',6,'evidenceRefresh',1.20,'Recover feeds, fees and books when the measured matrix collapses.'),
  s(98,'runtime_evidence_resilience','positive_latency_burst','Positive-edge latency burst','positiveModes','gte',1,'latencyFocus',1.24,'Reduce time from observation to canonical revalidation.'),
  s(99,'runtime_evidence_resilience','near_gap_evidence_lock','Near-gap evidence lock','closestFeeGapBps','lte',3,'evidenceRefresh',1.18,'Keep all critical inputs current around the break-even boundary.'),
  s(100,'runtime_evidence_resilience','no_regression_floor','No-regression exploration floor','observedModes','gte',1,'exploration',1.00,'Preserve a nonzero exploration floor while exploiting measured edges.'),
] as const;

if (HYPERDYNAMIC_BPS_SOLUTIONS.length !== 100) {
  throw new Error(`Hyperdynamic BPS solution catalog must contain exactly 100 solutions; found ${HYPERDYNAMIC_BPS_SOLUTIONS.length}`);
}

export interface HyperdynamicBpsPlan {
  catalogSize: 100;
  activeSolutionCount: number;
  activeSolutionIds: number[];
  activeSolutionKeys: string[];
  cexPriorityMultiplier: number;
  zeroCapitalPriorityMultiplier: number;
  breadthMultiplier: number;
  cadenceMultiplier: number;
  recoveryQuotaMultiplier: number;
  hybridQuotaMultiplier: number;
  feeRefreshMultiplier: number;
  feeRefreshMaxAgeMs: number;
  makerFocusMultiplier: number;
  sizeRefinementMultiplier: number;
  quoteBudgetMultiplier: number;
  mcSearchMultiplier: number;
  explorationMultiplier: number;
  stalePenaltyMultiplier: number;
  liquidityFocusMultiplier: number;
  latencyFocusMultiplier: number;
  venueDiversityMultiplier: number;
  evidenceRefreshMultiplier: number;
  gasSensitivityMultiplier: number;
  switchHysteresisMultiplier: number;
  riskBufferMultiplier: number;
  authority: 'bounded_measured_profitability_policy_only';
  executionAuthority: false;
  syntheticEconomicsAllowed: false;
}

const LEVER_BOUNDS: Record<BpsLever, [number, number]> = {
  cexPriority: [0.55, 2.25],
  zeroCapitalPriority: [0.55, 2.00],
  breadth: [0.50, 1.50],
  cadence: [0.40, 1.80],
  recoveryQuota: [0.75, 1.75],
  hybridQuota: [0.75, 1.75],
  feeRefresh: [0.15, 1.25],
  makerFocus: [0.75, 2.00],
  sizeRefinement: [0.70, 1.90],
  quoteBudget: [0.50, 2.00],
  mcSearch: [0.70, 1.85],
  exploration: [0.70, 1.35],
  stalePenalty: [0.70, 1.40],
  liquidityFocus: [0.75, 1.80],
  latencyFocus: [0.75, 1.80],
  venueDiversity: [0.70, 1.70],
  evidenceRefresh: [0.75, 1.80],
  gasSensitivity: [0.70, 1.50],
  switchHysteresis: [0.80, 1.80],
  riskBuffer: [0.80, 1.30],
};

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function metric(input: HyperdynamicBpsInput, key: BpsMetric): number | null {
  return finite(input[key]);
}

function matches(input: HyperdynamicBpsInput, solution: BpsSolutionDefinition): boolean {
  const value = metric(input, solution.metric);
  if (value === null) return false;
  return solution.direction === 'lte' ? value <= solution.threshold : value >= solution.threshold;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function buildHyperdynamicBpsPlan(input: HyperdynamicBpsInput): HyperdynamicBpsPlan {
  const factors = Object.fromEntries((Object.keys(LEVER_BOUNDS) as BpsLever[]).map(key => [key, 1])) as Record<BpsLever, number>;
  const active: BpsSolutionDefinition[] = [];
  for (const solution of HYPERDYNAMIC_BPS_SOLUTIONS) {
    if (!matches(input, solution)) continue;
    active.push(solution);
    factors[solution.lever] *= solution.factor;
  }
  for (const lever of Object.keys(factors) as BpsLever[]) {
    const [min, max] = LEVER_BOUNDS[lever];
    factors[lever] = clamp(factors[lever], min, max);
  }

  // Fee evidence age is deliberately bounded. The policy can ask for fresher
  // authenticated evidence, but it cannot invent or extend evidence freshness.
  const feeRefreshMaxAgeMs = Math.round(clamp(60_000 * factors.feeRefresh / factors.evidenceRefresh, 5_000, 120_000));

  return {
    catalogSize: 100,
    activeSolutionCount: active.length,
    activeSolutionIds: active.map(item => item.id),
    activeSolutionKeys: active.map(item => item.key),
    cexPriorityMultiplier: factors.cexPriority,
    zeroCapitalPriorityMultiplier: factors.zeroCapitalPriority,
    breadthMultiplier: factors.breadth,
    cadenceMultiplier: factors.cadence,
    recoveryQuotaMultiplier: factors.recoveryQuota,
    hybridQuotaMultiplier: factors.hybridQuota,
    feeRefreshMultiplier: factors.feeRefresh,
    feeRefreshMaxAgeMs,
    makerFocusMultiplier: factors.makerFocus,
    sizeRefinementMultiplier: factors.sizeRefinement,
    quoteBudgetMultiplier: factors.quoteBudget,
    mcSearchMultiplier: factors.mcSearch,
    explorationMultiplier: factors.exploration,
    stalePenaltyMultiplier: factors.stalePenalty,
    liquidityFocusMultiplier: factors.liquidityFocus,
    latencyFocusMultiplier: factors.latencyFocus,
    venueDiversityMultiplier: factors.venueDiversity,
    evidenceRefreshMultiplier: factors.evidenceRefresh,
    gasSensitivityMultiplier: factors.gasSensitivity,
    switchHysteresisMultiplier: factors.switchHysteresis,
    riskBufferMultiplier: factors.riskBuffer,
    authority: 'bounded_measured_profitability_policy_only',
    executionAuthority: false,
    syntheticEconomicsAllowed: false,
  };
}
