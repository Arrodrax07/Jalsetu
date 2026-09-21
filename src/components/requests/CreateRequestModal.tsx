import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { Community, UrgencyLevel, VulnerabilityLevel, AIAssessment } from '../../types';
import { useWaterData } from '../../context/WaterDataContext';
import { Sparkles, CheckCircle, AlertTriangle, Calculator } from 'lucide-react';

interface CreateRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedCommunity?: Community | null;
}

export const CreateRequestModal: React.FC<CreateRequestModalProps> = ({
  isOpen,
  onClose,
  preselectedCommunity
}) => {
  const { communities, createRequest } = useWaterData();

  const [communityId, setCommunityId] = useState(preselectedCommunity ? preselectedCommunity.id : communities[0]?.id || '');
  const [waterRequired, setWaterRequired] = useState<number>(15000);
  const [peopleCurrentlyServed, setPeopleCurrentlyServed] = useState<number>(2000);
  const [vulnerability, setVulnerability] = useState<VulnerabilityLevel>('High');
  const [reason, setReason] = useState<string>('Main feeder line ruptured; community tap dry for 3 days.');
  const [daysWithoutWater, setDaysWithoutWater] = useState<number>(3);
  const [contactPerson, setContactPerson] = useState<string>('Imran Ansari');
  const [phone, setPhone] = useState<string>('+91 98205 11982');

  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [aiAssessment, setAiAssessment] = useState<AIAssessment | null>(null);

  const selectedComm = communities.find(c => c.id === communityId) || communities[0];
  const population = selectedComm ? selectedComm.population : 8420;

  const handleAnalyze = () => {
    setIsAnalyzing(true);
    setAiAssessment(null);

    setTimeout(() => {
      // Deterministic priority calculation based on input metrics
      let demandLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'HIGH';
      if (waterRequired >= 18000 || daysWithoutWater >= 3) {
        demandLevel = 'CRITICAL';
      } else if (waterRequired < 8000) {
        demandLevel = 'LOW';
      }

      let vulnLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'HIGH';
      if (vulnerability === 'Very High') vulnLevel = 'CRITICAL';
      else if (vulnerability === 'Low') vulnLevel = 'LOW';
      else if (vulnerability === 'Medium') vulnLevel = 'MEDIUM';

      const shortfall = Math.max(0, waterRequired - Math.round(peopleCurrentlyServed * 5));
      const score = Math.min(
        100,
        Math.round(
          0.35 * Math.min(100, (waterRequired / 20000) * 100) +
          0.30 * (vulnerability === 'Very High' ? 95 : vulnerability === 'High' ? 85 : 60) +
          0.20 * Math.min(100, daysWithoutWater * 30) +
          0.15 * Math.min(100, (population / 15000) * 100)
        )
      );

      let reasoning = `High population of ${population.toLocaleString()} residents, ${daysWithoutWater} consecutive days of deficit, high vulnerability index and critical shortfall elevate ticket to priority status.`;
      if (score >= 90) {
        reasoning = `CRITICAL ALERT: ${daysWithoutWater} days without adequate water supply, high informal demographic vulnerability, and large unserved population require emergency tanker allocation.`;
      }

      setAiAssessment({
        demandLevel,
        vulnerability: vulnLevel,
        estimatedShortfall: shortfall > 0 ? shortfall : waterRequired,
        priorityScore: score,
        reasoning
      });
      setIsAnalyzing(false);
    }, 600);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    let urgency: UrgencyLevel = 'Medium';
    if (aiAssessment?.priorityScore && aiAssessment.priorityScore >= 88) {
      urgency = 'Critical';
    } else if (aiAssessment?.priorityScore && aiAssessment.priorityScore >= 70) {
      urgency = 'High';
    }

    createRequest({
      communityId,
      communityName: selectedComm.name,
      requestedAmount: Number(waterRequired),
      urgency,
      population,
      peopleCurrentlyServed: Number(peopleCurrentlyServed),
      vulnerability,
      reason,
      daysWithoutWater: Number(daysWithoutWater),
      contactPerson,
      phone,
      status: 'Pending',
      priorityScore: aiAssessment?.priorityScore || 85,
      aiAssessment: aiAssessment || undefined
    });

    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create Community Water Request"
      subtitle="JalSetu AI analyzes real-time vulnerability, population density, and shortfall metrics."
      maxWidth="2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Community & Population */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Target Community</label>
            <select
              value={communityId}
              onChange={(e) => {
                setCommunityId(e.target.value);
                setAiAssessment(null);
              }}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 font-medium"
            >
              {communities.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.ward}) - Pop: {c.population.toLocaleString()}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Total Population</label>
            <input
              type="text"
              readOnly
              value={`${population.toLocaleString()} residents`}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-100 text-slate-600 font-medium cursor-not-allowed"
            />
          </div>
        </div>

        {/* Litres & People Served */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Water Required (Litres)</label>
            <div className="relative">
              <input
                type="number"
                min="1000"
                step="500"
                value={waterRequired}
                onChange={(e) => {
                  setWaterRequired(Number(e.target.value));
                  setAiAssessment(null);
                }}
                required
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 font-medium"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium">L</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">People Currently Served</label>
            <input
              type="number"
              min="0"
              value={peopleCurrentlyServed}
              onChange={(e) => {
                setPeopleCurrentlyServed(Number(e.target.value));
                setAiAssessment(null);
              }}
              required
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 font-medium"
            />
          </div>
        </div>

        {/* Vulnerability & Days Without Water */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Vulnerability Level</label>
            <select
              value={vulnerability}
              onChange={(e) => {
                setVulnerability(e.target.value as VulnerabilityLevel);
                setAiAssessment(null);
              }}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 font-medium"
            >
              <option value="Low">Low (Piped municipal connections)</option>
              <option value="Medium">Medium (Intermittent supply)</option>
              <option value="High">High (High density, tanker reliant)</option>
              <option value="Very High">Very High (Informal settlement, medical clinic)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Days Without Adequate Water</label>
            <input
              type="number"
              min="0"
              max="15"
              value={daysWithoutWater}
              onChange={(e) => {
                setDaysWithoutWater(Number(e.target.value));
                setAiAssessment(null);
              }}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 font-medium"
            />
          </div>
        </div>

        {/* Reason / Context */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Reason for Request</label>
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            placeholder="E.g., Pipeline rupture, public tap pressure failure, health center requirement..."
            className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 font-medium"
          />
        </div>

        {/* Contact Info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Contact Person / Community Rep</label>
            <input
              type="text"
              value={contactPerson}
              onChange={(e) => setContactPerson(e.target.value)}
              required
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 font-medium"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Contact Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 font-medium"
            />
          </div>
        </div>

        {/* Analyze Request Button */}
        <div className="pt-2">
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-sky-600 to-sky-700 hover:from-sky-700 hover:to-sky-800 text-white text-xs font-bold shadow-card transition-all"
          >
            {isAnalyzing ? (
              <>
                <Calculator className="w-4 h-4 animate-spin" />
                <span>Running JalSetu AI Priority Engine...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-sky-200" />
                <span>Analyze Request with AI</span>
              </>
            )}
          </button>
        </div>

        {/* AI Assessment Panel */}
        {aiAssessment && (
          <div className="p-4 rounded-xl bg-sky-50/80 border border-sky-200 space-y-3 animate-scale-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-bold text-xs text-sky-900 uppercase tracking-wider">
                <Sparkles className="w-4 h-4 text-sky-600" />
                AI Assessment & Priority Scoring
              </div>
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-sky-600 text-white">
                Score: {aiAssessment.priorityScore}/100
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="bg-white p-2 rounded-lg border border-sky-100">
                <p className="text-[10px] text-slate-400 font-medium uppercase">Demand Level</p>
                <p className="font-bold text-slate-800 mt-0.5">{aiAssessment.demandLevel}</p>
              </div>
              <div className="bg-white p-2 rounded-lg border border-sky-100">
                <p className="text-[10px] text-slate-400 font-medium uppercase">Vulnerability</p>
                <p className="font-bold text-slate-800 mt-0.5">{aiAssessment.vulnerability}</p>
              </div>
              <div className="bg-white p-2 rounded-lg border border-sky-100">
                <p className="text-[10px] text-slate-400 font-medium uppercase">Estimated Shortfall</p>
                <p className="font-bold text-rose-600 mt-0.5">{aiAssessment.estimatedShortfall.toLocaleString()} L</p>
              </div>
            </div>

            <div className="text-xs text-sky-950 bg-white/70 p-2.5 rounded-lg border border-sky-200/60 leading-relaxed">
              <span className="font-semibold text-sky-900">AI Reasoning: </span>
              {aiAssessment.reasoning}
            </div>
          </div>
        )}

        {/* Form Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm transition-colors"
          >
            <CheckCircle className="w-4 h-4" />
            Submit Request
          </button>
        </div>
      </form>
    </Modal>
  );
};
