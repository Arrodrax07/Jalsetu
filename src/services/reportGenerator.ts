import { Community, WaterRequest, Complaint, Tanker, DeliveryRecord, AllocationPlanItem } from '../types';

export interface GeneratedReport {
  title: string;
  generatedDate: string;
  summary: Record<string, string | number>;
  tableHeaders: string[];
  tableRows: (string | number)[][];
}

export function generateDailyReport(
  communities: Community[],
  requests: WaterRequest[],
  complaints: Complaint[],
  tankers: Tanker[],
  deliveries: DeliveryRecord[]
): GeneratedReport {
  const totalAllocated = communities.reduce((acc, c) => acc + c.allocatedWater, 0);
  const totalDelivered = deliveries.reduce((acc, d) => acc + d.deliveredAmount, 0);
  const criticalRequests = requests.filter(r => r.urgency === 'Critical').length;
  const resolvedComplaints = complaints.filter(c => c.status === 'Resolved').length;

  return {
    title: 'Daily Municipal Water Operations Report',
    generatedDate: new Date().toLocaleDateString('en-IN', { dateStyle: 'full' }),
    summary: {
      'Communities Monitored': communities.length,
      'Total Water Allocated': `${totalAllocated.toLocaleString()} L`,
      'Total Water Delivered': `${totalDelivered.toLocaleString()} L`,
      'Critical Requests Handled': criticalRequests,
      'Resolved Grievances': `${resolvedComplaints} / ${complaints.length}`,
      'Active Tankers in Field': tankers.filter(t => t.status === 'En Route' || t.status === 'Loading').length,
      'Average Delivery Time': '42 min',
      'Municipal Coverage Balance': '86%'
    },
    tableHeaders: ['Community', 'Ward', 'Population', 'Daily Demand', 'Allocated', 'Coverage %', 'Vulnerability', 'Status'],
    tableRows: communities.map(c => [
      c.name,
      c.ward,
      c.population.toLocaleString(),
      `${c.dailyDemand.toLocaleString()} L`,
      `${c.allocatedWater.toLocaleString()} L`,
      `${c.currentCoverage}%`,
      c.vulnerability,
      c.status
    ])
  };
}

export function generateAllocationReport(plan: AllocationPlanItem[]): GeneratedReport {
  const totalRecommended = plan.reduce((acc, p) => acc + p.recommendedAllocation, 0);

  return {
    title: 'Fair Allocation Engine Strategic Distribution Plan',
    generatedDate: new Date().toLocaleDateString('en-IN', { dateStyle: 'full' }),
    summary: {
      'Total Demand Evaluated': `${plan.reduce((a, b) => a + b.demand, 0).toLocaleString()} L`,
      'Total Recommended Allocation': `${totalRecommended.toLocaleString()} L`,
      'Fairness Index Before': '62%',
      'Fairness Index After': '84%',
      'Protected High-Vulnerability Zones': plan.filter(p => p.priorityScore >= 85).length
    },
    tableHeaders: ['Community', 'Daily Demand', 'Previous Allocation', 'Priority Score', 'AI Recommended', 'Justification'],
    tableRows: plan.map(p => [
      p.communityName,
      `${p.demand.toLocaleString()} L`,
      `${p.previousAllocation.toLocaleString()} L`,
      `${p.priorityScore}/100`,
      `${p.recommendedAllocation.toLocaleString()} L`,
      p.reason
    ])
  };
}

export function exportToCSV(filename: string, headers: string[], rows: (string | number)[][]): void {
  const escapeCsv = (val: string | number) => `"${String(val).replace(/"/g, '""')}"`;
  const headerLine = headers.map(escapeCsv).join(',');
  const rowLines = rows.map(r => r.map(escapeCsv).join(',')).join('\n');
  const csvContent = `${headerLine}\n${rowLines}`;

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
