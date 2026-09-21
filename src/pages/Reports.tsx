import React, { useState } from 'react';
import {
  FileSpreadsheet,
  Download,
  Printer,
  Calendar,
  CheckCircle2,
  FileText,
  Cpu,
  AlertCircle,
  BarChart3
} from 'lucide-react';
import { useWaterData } from '../context/WaterDataContext';
import { generateDailyReport, generateAllocationReport, exportToCSV, GeneratedReport } from '../services/reportGenerator';

export const Reports: React.FC = () => {
  const { communities, requests, complaints, tankers, deliveries, allocationPlan, addToast } = useWaterData();
  const [activeReportType, setActiveReportType] = useState<'daily' | 'allocation' | 'complaints' | 'impact'>('daily');

  // Compute report on the fly
  let reportData: GeneratedReport;
  if (activeReportType === 'allocation') {
    reportData = generateAllocationReport(allocationPlan);
  } else {
    reportData = generateDailyReport(communities, requests, complaints, tankers, deliveries);
  }

  const handleExportCSV = () => {
    exportToCSV(`JalSetu_${activeReportType}_report`, reportData.tableHeaders, reportData.tableRows);
    addToast('Report Exported', 'CSV file downloaded to your system.', 'success');
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900">
            Municipal Operations & Audit Reports
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Generate and export verifiable water governance documentation for municipal oversight.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-bold shadow-sm transition-all"
          >
            <Download className="w-4 h-4 text-sky-600" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-card transition-all"
          >
            <Printer className="w-4 h-4 text-slate-300" />
            <span>Print Report (PDF)</span>
          </button>
        </div>
      </div>

      {/* Report Type Selector Buttons */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button
          onClick={() => setActiveReportType('daily')}
          className={`p-4 rounded-xl border text-left transition-all ${
            activeReportType === 'daily'
              ? 'bg-sky-50 border-sky-400 shadow-sm ring-1 ring-sky-300'
              : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <FileText className={`w-5 h-5 mb-2 ${activeReportType === 'daily' ? 'text-sky-600' : 'text-slate-400'}`} />
          <h4 className="text-xs font-bold text-slate-900">Daily Operations</h4>
          <p className="text-[11px] text-slate-500 mt-0.5">Fleet dispatches & volumes</p>
        </button>

        <button
          onClick={() => setActiveReportType('allocation')}
          className={`p-4 rounded-xl border text-left transition-all ${
            activeReportType === 'allocation'
              ? 'bg-sky-50 border-sky-400 shadow-sm ring-1 ring-sky-300'
              : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <Cpu className={`w-5 h-5 mb-2 ${activeReportType === 'allocation' ? 'text-sky-600' : 'text-slate-400'}`} />
          <h4 className="text-xs font-bold text-slate-900">Allocation Engine</h4>
          <p className="text-[11px] text-slate-500 mt-0.5">Fairness metrics & AI quotas</p>
        </button>

        <button
          onClick={() => setActiveReportType('complaints')}
          className={`p-4 rounded-xl border text-left transition-all ${
            activeReportType === 'complaints'
              ? 'bg-sky-50 border-sky-400 shadow-sm ring-1 ring-sky-300'
              : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <AlertCircle className={`w-5 h-5 mb-2 ${activeReportType === 'complaints' ? 'text-sky-600' : 'text-slate-400'}`} />
          <h4 className="text-xs font-bold text-slate-900">Grievance Audit</h4>
          <p className="text-[11px] text-slate-500 mt-0.5">Resolution rate & repeated clusters</p>
        </button>

        <button
          onClick={() => setActiveReportType('impact')}
          className={`p-4 rounded-xl border text-left transition-all ${
            activeReportType === 'impact'
              ? 'bg-sky-50 border-sky-400 shadow-sm ring-1 ring-sky-300'
              : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <BarChart3 className={`w-5 h-5 mb-2 ${activeReportType === 'impact' ? 'text-sky-600' : 'text-slate-400'}`} />
          <h4 className="text-xs font-bold text-slate-900">Impact Assessment</h4>
          <p className="text-[11px] text-slate-500 mt-0.5">Distance & equity outcomes</p>
        </button>
      </div>

      {/* Printable Report Preview Sheet */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-subtle p-6 space-y-6">
        {/* Document Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between border-b border-slate-200 pb-4 gap-4">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-sky-600">
              Government of Maharashtra • Greater Mumbai Municipal Corporation
            </span>
            <h3 className="text-xl font-black text-slate-900 mt-1">{reportData.title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">Date of Generation: {reportData.generatedDate}</p>
          </div>
          <div className="text-right">
            <span className="text-[10px] uppercase font-bold text-slate-400">Security Classification</span>
            <p className="text-xs font-bold text-slate-700 mt-0.5">Official Audit Record</p>
          </div>
        </div>

        {/* High-Level Metric Tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Object.entries(reportData.summary).map(([key, val]) => (
            <div key={key} className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-[10px] uppercase font-bold text-slate-400">{key}</span>
              <p className="text-base font-bold text-slate-900 mt-0.5">{val}</p>
            </div>
          ))}
        </div>

        {/* Tabular Output */}
        <div className="overflow-x-auto border border-slate-100 rounded-xl">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                {reportData.tableHeaders.map((head, idx) => (
                  <th key={idx} className="px-4 py-2.5">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reportData.tableRows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-slate-50/50">
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-4 py-2.5 text-slate-700">
                      {String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Document Footer Sign-off */}
        <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
          <span>Digitally generated via JalSetu AI Engine v1.0 • Ecoders</span>
          <span>Approved by Municipal Water Commissioner</span>
        </div>
      </div>
    </div>
  );
};
