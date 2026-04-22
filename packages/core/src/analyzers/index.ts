/**
 * Re-exports issue/PR analyzers (duplicates, labels, PR scoring).
 */
export { runDuplicateDetection } from "./duplicateDetector.js";
export { runLabelClassification } from "./labelClassifier.js";
export { runPrScoring, globLike } from "./prScorer.js";
export type {
  DuplicateAnalysis,
} from "./duplicateDetector.js";
export type {
  LabelAnalysis,
} from "./labelClassifier.js";
export type {
  PrScoreAnalysis,
  PrScoreReport,
  DimensionResult,
  CheckStatus,
} from "./prScorer.js";
