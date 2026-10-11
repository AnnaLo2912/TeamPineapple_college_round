import React from 'react';
import { Target, FileText, BookOpen, BarChart3, Compass, Award, Sparkles, ExternalLink } from 'lucide-react';

export default function Header({ activeTab, onSelectTab, onOpenJudgingModal, isPresentationMode, onTogglePresentationMode }) {
  const tabs = [
    { id: 'fitts', label: 'Target Acquisition (Fitts\' Law)', icon: Target },
    { id: 'form', label: 'Form Filling Benchmark', icon: FileText },
    { id: 'article', label: 'Article Reading & Navigation', icon: BookOpen },
    { id: 'trajectory', label: 'Trajectory Smoothness Lab', icon: Compass },
    { id: 'dashboard', label: 'Comparative Metrics Dashboard', icon: BarChart3 },
  ];

  return (
    <header className="app-header">
      <div className="header-top-row">
        <div className="brand-group">
          <div className="brand-logo-icon">
            <Sparkles size={22} className="text-primary-glow" />
          </div>
          <div>
            <div className="brand-title-wrap">
              <h1 className="brand-title">Handsfree</h1>
              <span className="brand-tag">Evaluation Suite</span>
              <span className="brand-college-tag">College Round Judging</span>
            </div>
            <p className="brand-subtext">Quantitative Accessibility Benchmarking & Motor Efficacy Platform</p>
          </div>
        </div>

        <div className="header-actions">
          <button
            className={`btn-presentation-toggle ${isPresentationMode ? 'active' : ''}`}
            onClick={onTogglePresentationMode}
            title="Toggle Clinical Trial Presentation Dataset for Competition Judging"
          >
            <span className="dot-status" />
            <span>Judging Mode: {isPresentationMode ? 'ON (Clinical Data Loaded)' : 'OFF (Live Test Mode)'}</span>
          </button>

          <button className="btn btn-primary btn-sm" onClick={onOpenJudgingModal}>
            <Award size={15} /> Executive Summary
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <nav className="tab-nav-bar" aria-label="Benchmark Scenarios">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              className={`tab-btn ${isActive ? 'active' : ''}`}
              onClick={() => onSelectTab(tab.id)}
            >
              <Icon size={16} className={isActive ? 'text-primary' : 'text-muted'} />
              <span>{tab.label}</span>
              {isActive && <div className="active-tab-glow-indicator" />}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
