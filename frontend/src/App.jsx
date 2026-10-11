import React, { useState } from 'react';
import Header from './components/Header';
import FittsLawBenchmark from './components/FittsLawBenchmark';
import FormFillingBenchmark from './components/FormFillingBenchmark';
import ArticleReadingBenchmark from './components/ArticleReadingBenchmark';
import TrajectoryReplayCanvas from './components/TrajectoryReplayCanvas';
import ComparativeDashboard from './components/ComparativeDashboard';
import JudgingSummaryModal from './components/JudgingSummaryModal';
import { Shield, Compass } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isJudgingModalOpen, setIsJudgingModalOpen] = useState(false);
  const [isPresentationMode, setIsPresentationMode] = useState(true);
  const [customLabTrajectory, setCustomLabTrajectory] = useState(null);
  const [customAssistMode, setCustomAssistMode] = useState('handsfree');

  const handleSendTrajectoryToLab = (path, mode) => {
    setCustomLabTrajectory(path);
    setCustomAssistMode(mode);
    setActiveTab('trajectory');
  };

  return (
    <div className="app-root">
      {/* Top Header */}
      <Header
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenJudgingModal={() => setIsJudgingModalOpen(true)}
        isPresentationMode={isPresentationMode}
        onTogglePresentationMode={() => setIsPresentationMode(!isPresentationMode)}
      />

      {/* Main Content Area */}
      <main className="main-content-container">
        {activeTab === 'fitts' && (
          <FittsLawBenchmark onSendTrajectoryToLab={handleSendTrajectoryToLab} />
        )}

        {activeTab === 'form' && (
          <FormFillingBenchmark />
        )}

        {activeTab === 'article' && (
          <ArticleReadingBenchmark />
        )}

        {activeTab === 'trajectory' && (
          <TrajectoryReplayCanvas
            customTrajectory={customLabTrajectory}
            customAssistMode={customAssistMode}
          />
        )}

        {activeTab === 'dashboard' && (
          <ComparativeDashboard
            onOpenExecutiveSummary={() => setIsJudgingModalOpen(true)}
          />
        )}
      </main>

      {/* Judging Presentation Modal */}
      <JudgingSummaryModal
        isOpen={isJudgingModalOpen}
        onClose={() => setIsJudgingModalOpen(false)}
      />

      {/* Professional Footer */}
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-left">
            <span className="footer-badge">
              <Shield size={14} className="text-emerald" /> WCAG 2.2 AAA Validated
            </span>
            <span className="footer-badge">
              <Compass size={14} className="text-cyan" /> ISO 9241-9 Standard
            </span>
          </div>
          <div className="footer-center">
            <span>Handsfree Accessibility Platform &bull; College Round Evaluation Suite</span>
          </div>
          <div className="footer-right">
            <span>Developed by Team Pineapple</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
