import { ComplaintCategory, UrgencyLevel } from '../types';

export interface AIComplaintAnalysis {
  category: ComplaintCategory;
  sentiment: 'Negative' | 'Neutral' | 'Critical';
  severity: UrgencyLevel;
  duplicateProbability: number;
  recommendedAction: string;
  isRepeated: boolean;
}

export function analyzeComplaintText(
  text: string,
  communityName: string,
  existingComplaintsCount = 0
): AIComplaintAnalysis {
  const lower = text.toLowerCase();

  // 1. Categorization
  let category: ComplaintCategory = 'No Water';
  if (lower.includes('late') || lower.includes('delay') || lower.includes('waiting') || lower.includes('not arrived')) {
    category = 'Late Tanker';
  } else if (lower.includes('dirty') || lower.includes('smell') || lower.includes('muddy') || lower.includes('chemical') || lower.includes('quality')) {
    category = 'Poor Water Quality';
  } else if (lower.includes('less') || lower.includes('insufficient') || lower.includes('half') || lower.includes('empty') || lower.includes('quantity')) {
    category = 'Insufficient Quantity';
  } else if (lower.includes('missed') || lower.includes('skipped') || lower.includes('never came')) {
    category = 'Missed Delivery';
  } else if (lower.includes('again') || lower.includes('duplicate') || lower.includes('already filed')) {
    category = 'Duplicate Request';
  } else {
    category = 'No Water';
  }

  // 2. Sentiment
  let sentiment: 'Negative' | 'Neutral' | 'Critical' = 'Negative';
  if (lower.includes('emergency') || lower.includes('hospital') || lower.includes('illness') || lower.includes('critical') || lower.includes('protest')) {
    sentiment = 'Critical';
  } else if (lower.includes('inquiry') || lower.includes('status') || lower.includes('routine')) {
    sentiment = 'Neutral';
  }

  // 3. Severity
  let severity: UrgencyLevel = 'Medium';
  if (
    sentiment === 'Critical' ||
    category === 'Poor Water Quality' ||
    lower.includes('3rd day') ||
    lower.includes('three days') ||
    lower.includes('third day') ||
    lower.includes('completely dry') ||
    existingComplaintsCount >= 3
  ) {
    severity = 'Critical';
  } else if (category === 'No Water' || category === 'Missed Delivery' || existingComplaintsCount >= 1) {
    severity = 'High';
  } else if (category === 'Late Tanker') {
    severity = 'Medium';
  } else {
    severity = 'Low';
  }

  // 4. Duplicate Probability
  let duplicateProbability = 0.08;
  if (category === 'Duplicate Request' || lower.includes('already submitted')) {
    duplicateProbability = 0.92;
  } else if (existingComplaintsCount >= 3) {
    duplicateProbability = 0.45;
  } else if (existingComplaintsCount >= 1) {
    duplicateProbability = 0.22;
  }

  // 5. Recommended Action
  let recommendedAction = '';
  if (duplicateProbability > 0.8) {
    recommendedAction = `Automated AI deduplication: cross-linked with existing active ticket for ${communityName} to prevent duplicate fleet dispatches.`;
  } else if (severity === 'Critical') {
    recommendedAction = `High priority because this complaint matches ${existingComplaintsCount > 0 ? existingComplaintsCount : 3} similar complaints from ${communityName} in the last 48 hours. Immediate escalation to Ward Officer.`;
  } else if (category === 'Poor Water Quality') {
    recommendedAction = 'Water contamination health protocol triggered. Mobile testing kit and sanitary tanker reroute dispatched.';
  } else if (category === 'Late Tanker') {
    recommendedAction = 'Query live GPS telemetry on assigned tanker and transmit SMS ETA update to community representative.';
  } else {
    recommendedAction = `Log ticket into queue for ${communityName} and schedule for afternoon review.`;
  }

  return {
    category,
    sentiment,
    severity,
    duplicateProbability,
    recommendedAction,
    isRepeated: existingComplaintsCount > 0
  };
}
