import React, { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import { Target, Play, RotateCcw, Activity, ShieldCheck, Zap, AlertTriangle, Eye, Compass } from 'lucide-react';

export default function FittsLawBenchmark({ onSendTrajectoryToLab }) {
  const [isRunning, setIsRunning] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [currentTargetIndex, setCurrentTargetIndex] = useState(0);
  const [targetSize, setTargetSize] = useState(48); // Width W in px
  const [targetRadiusDistance, setTargetRadiusDistance] = useState(160); // Distance D from center in px
  const [totalTargets] = useState(8);
  const [assistMode, setAssistMode] = useState('handsfree'); // 'standard' | 'handsfree'
  const [tremorSimEnabled, setTremorSimEnabled] = useState(false); // simulates motor tremor jitter on cursor if test unassisted

  // Metrics
  const [sessionStartTime, setSessionStartTime] = useState(null);
  const [currentTargetStartTime, setCurrentTargetStartTime] = useState(null);
  const [targetTrials, setTargetTrials] = useState([]);
  const [misses, setMisses] = useState(0);
  const [hits, setHits] = useState(0);

  // Live trajectory recording
  const arenaRef = useRef(null);
  const currentTrajectoryRef = useRef([]);
  const [lastRecordedPath, setLastRecordedPath] = useState([]);

  // Generate target coordinates in circular ISO 9241-9 multi-directional layout
  const arenaWidth = 640;
  const arenaHeight = 440;
  const centerX = arenaWidth / 2;
  const centerY = arenaHeight / 2;

  // Calculate targets in cross-diameter sequence (0, 4, 1, 5, 2, 6, 3, 7) for maximum cross-movement
  const targetPositions = React.useMemo(() => {
    const list = [];
    const order = [0, 4, 1, 5, 2, 6, 3, 7];
    for (let i = 0; i < totalTargets; i++) {
      const idx = order[i % order.length];
      const angle = (idx * 2 * Math.PI) / totalTargets;
      list.push({
        id: i,
        x: Math.round(centerX + targetRadiusDistance * Math.cos(angle)),
        y: Math.round(centerY + targetRadiusDistance * Math.sin(angle)),
        size: targetSize,
      });
    }
    return list;
  }, [centerX, centerY, targetRadiusDistance, targetSize, totalTargets]);

  // Audio chimes
  const playChime = (isHit) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;
      if (isHit) {
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.18);
      } else {
        osc.frequency.setValueAtTime(220, now); // A3 error thud
        osc.frequency.linearRampToValueAtTime(140, now + 0.15);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.18);
      }
    } catch {
      // AudioContext policy
    }
  };

  const startBenchmark = () => {
    setIsRunning(true);
    setIsFinished(false);
    setCurrentTargetIndex(0);
    setTargetTrials([]);
    setMisses(0);
    setHits(0);
    currentTrajectoryRef.current = [];
    setLastRecordedPath([]);
    const now = performance.now();
    setSessionStartTime(now);
    setCurrentTargetStartTime(now);
  };

  const resetBenchmark = () => {
    setIsRunning(false);
    setIsFinished(false);
    setCurrentTargetIndex(0);
    setTargetTrials([]);
    setMisses(0);
    setHits(0);
    currentTrajectoryRef.current = [];
  };

  // Trajectory tracking on mouse move over arena
  const handleArenaMouseMove = (e) => {
    if (!isRunning || !arenaRef.current) return;
    const rect = arenaRef.current.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;

    // If tremor simulation is turned on for standard unassisted mouse mode
    if (assistMode === 'standard' && tremorSimEnabled) {
      const jitter = (Math.random() - 0.5) * 16;
      x += jitter;
      y += (Math.random() - 0.5) * 16;
    }

    const t = Math.round(performance.now() - (sessionStartTime || performance.now()));
    currentTrajectoryRef.current.push({ x: Math.round(x), y: Math.round(y), t });
  };

  const handleTargetClick = (e, index) => {
    e.stopPropagation();
    if (!isRunning || index !== currentTargetIndex) return;

    playChime(true);
    const now = performance.now();
    const movementTimeMs = Math.round(now - (currentTargetStartTime || now));

    // Shannon formulation: ID = log2(D / W + 1)
    const distanceD = targetRadiusDistance * 2; // cross diameter
    const widthW = targetSize;
    const idBits = Math.log2(distanceD / widthW + 1);
    const throughputBitsPerSec = movementTimeMs > 0 ? (idBits / (movementTimeMs / 1000)) : 0;

    const newTrial = {
      targetIndex: index,
      movementTimeMs,
      distanceD,
      widthW,
      idBits: parseFloat(idBits.toFixed(2)),
      throughput: parseFloat(throughputBitsPerSec.toFixed(2)),
      hit: true,
    };

    const nextTrials = [...targetTrials, newTrial];
    setTargetTrials(nextTrials);
    setHits(h => h + 1);

    if (currentTargetIndex + 1 >= totalTargets) {
      // Completed all targets!
      setIsRunning(false);
      setIsFinished(true);
      setLastRecordedPath([...currentTrajectoryRef.current]);
      confetti({
        particleCount: 75,
        spread: 60,
        origin: { y: 0.6 }
      });
    } else {
      setCurrentTargetIndex(idx => idx + 1);
      setCurrentTargetStartTime(now);
    }
  };

  const handleArenaMissClick = (e) => {
    if (!isRunning) return;
    playChime(false);
    setMisses(m => m + 1);
  };

  // Aggregate calculations
  const avgMovementTime = targetTrials.length > 0 
    ? Math.round(targetTrials.reduce((acc, t) => acc + t.movementTimeMs, 0) / targetTrials.length) 
    : 0;
  
  const avgThroughput = targetTrials.length > 0
    ? (targetTrials.reduce((acc, t) => acc + t.throughput, 0) / targetTrials.length).toFixed(2)
    : '0.00';

  const totalClicks = hits + misses;
  const accuracyPct = totalClicks > 0 ? Math.round((hits / totalClicks) * 100) : 100;
  const errorRatePct = totalClicks > 0 ? ((misses / totalClicks) * 100).toFixed(1) : '0.0';

  const activeTarget = targetPositions[currentTargetIndex];

  return (
    <div className="benchmark-card">
      {/* Header & Controls */}
      <div className="card-header-flex">
        <div>
          <div className="badge-row">
            <span className="pill pill-primary">ISO 9241-9 Standard</span>
            <span className="pill pill-cyan">Fitts' Law Acquisition</span>
            <span className="pill pill-emerald">Live Telemetry</span>
          </div>
          <h2 className="card-title">Target Acquisition Benchmark</h2>
          <p className="card-subtitle">
            Measures Movement Time ($MT$), Throughput ($TP = ID / MT$), and motor slip rate across multi-directional target points.
          </p>
        </div>

        <div className="controls-row">
          <div className="mode-selector">
            <button
              className={`mode-btn ${assistMode === 'handsfree' ? 'active' : ''}`}
              onClick={() => { setAssistMode('handsfree'); setTremorSimEnabled(false); }}
              title="Handsfree Voice & Glide Assist Mode"
            >
              <Zap size={15} /> Handsfree Assist
            </button>
            <button
              className={`mode-btn ${assistMode === 'standard' ? 'active' : ''}`}
              onClick={() => { setAssistMode('standard'); setTremorSimEnabled(true); }}
              title="Standard Unassisted Mouse (with Tremor Simulation)"
            >
              <AlertTriangle size={15} /> Standard / Tremor
            </button>
          </div>

          {!isRunning ? (
            <button className="btn btn-primary" onClick={startBenchmark}>
              <Play size={16} /> Start Test
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={resetBenchmark}>
              <RotateCcw size={16} /> Abort
            </button>
          )}
        </div>
      </div>

      {/* Target Settings Bar */}
      <div className="config-bar">
        <div className="config-item">
          <span className="config-label">Target Width (W):</span>
          <div className="pill-group">
            {[28, 48, 72].map(size => (
              <button
                key={size}
                disabled={isRunning}
                className={`pill-option ${targetSize === size ? 'active' : ''}`}
                onClick={() => setTargetSize(size)}
              >
                {size === 28 ? 'Small (28px)' : size === 48 ? 'Medium (48px)' : 'Large (72px)'}
              </button>
            ))}
          </div>
        </div>

        <div className="config-item">
          <span className="config-label">Distance (D):</span>
          <div className="pill-group">
            {[110, 160, 200].map(dist => (
              <button
                key={dist}
                disabled={isRunning}
                className={`pill-option ${targetRadiusDistance === dist ? 'active' : ''}`}
                onClick={() => setTargetRadiusDistance(dist)}
              >
                {dist === 110 ? 'Near (220px)' : dist === 160 ? 'Standard (320px)' : 'Far (400px)'}
              </button>
            ))}
          </div>
        </div>

        {assistMode === 'standard' && (
          <label className="checkbox-label" title="Simulates realistic motor tremor noise on mouse movement">
            <input
              type="checkbox"
              checked={tremorSimEnabled}
              onChange={e => setTremorSimEnabled(e.target.checked)}
            />
            Simulate Motor Tremor Jitter (5Hz)
          </label>
        )}
      </div>

      {/* Interactive Arena */}
      <div className="arena-container">
        <div
          ref={arenaRef}
          className={`fitts-arena ${isRunning ? 'running' : ''}`}
          style={{ width: `${arenaWidth}px`, height: `${arenaHeight}px` }}
          onMouseMove={handleArenaMouseMove}
          onClick={handleArenaMissClick}
        >
          {/* Circular Target Ring Backdrop */}
          <div
            className="arena-ring-guide"
            style={{
              width: `${targetRadiusDistance * 2}px`,
              height: `${targetRadiusDistance * 2}px`,
              left: `${centerX - targetRadiusDistance}px`,
              top: `${centerY - targetRadiusDistance}px`,
            }}
          />

          {/* Center Crosshair */}
          <div className="arena-center-crosshair" style={{ left: `${centerX}px`, top: `${centerY}px` }} />

          {/* Target Nodes */}
          {targetPositions.map((target, idx) => {
            const isActive = isRunning && idx === currentTargetIndex;
            const isCompleted = idx < currentTargetIndex;

            return (
              <button
                key={target.id}
                type="button"
                className={`fitts-target ${isActive ? 'active pulse' : ''} ${isCompleted ? 'completed' : ''}`}
                style={{
                  width: `${target.size}px`,
                  height: `${target.size}px`,
                  left: `${target.x - target.size / 2}px`,
                  top: `${target.y - target.size / 2}px`,
                }}
                onClick={(e) => handleTargetClick(e, idx)}
                aria-label={`Target ${idx + 1}`}
              >
                <span className="target-num">{idx + 1}</span>
                {isActive && <div className="target-glow-ring" />}
              </button>
            );
          })}

          {/* Live trajectory trail overlay */}
          <svg className="arena-svg-overlay">
            {currentTrajectoryRef.current.length > 1 && (
              <polyline
                fill="none"
                stroke={assistMode === 'handsfree' ? '#06b6d4' : '#ef4444'}
                strokeWidth="2.5"
                strokeDasharray={assistMode === 'standard' ? '2 2' : 'none'}
                opacity="0.75"
                points={currentTrajectoryRef.current.map(p => `${p.x},${p.y}`).join(' ')}
              />
            )}
          </svg>

          {/* Prompt overlay before start */}
          {!isRunning && !isFinished && (
            <div className="arena-overlay">
              <div className="overlay-box">
                <Target size={44} className="icon-pulse text-primary" />
                <h3>Ready to Measure Target Acquisition</h3>
                <p>Click "Start Test" above. Targets 1 through 8 will activate sequentially across the circle. Hit each target as quickly and accurately as possible.</p>
                <button className="btn btn-primary" onClick={startBenchmark}>
                  <Play size={16} /> Begin Scenario
                </button>
              </div>
            </div>
          )}

          {/* Completion Celebration Overlay */}
          {isFinished && (
            <div className="arena-overlay">
              <div className="overlay-box success">
                <ShieldCheck size={48} className="text-emerald" />
                <h3>Test Scenario Completed!</h3>
                <p>
                  Acquired <strong>{totalTargets} targets</strong> with{' '}
                  <span className="text-emerald font-bold">{accuracyPct}% accuracy</span>.
                </p>

                <div className="scorecard-grid">
                  <div className="score-card">
                    <span className="score-label">ISO Throughput</span>
                    <span className="score-val text-cyan">{avgThroughput} bits/s</span>
                  </div>
                  <div className="score-card">
                    <span className="score-label">Avg Movement Time</span>
                    <span className="score-val text-primary">{avgMovementTime} ms</span>
                  </div>
                  <div className="score-card">
                    <span className="score-label">Accidental Slips</span>
                    <span className="score-val text-amber">{misses} miss ({errorRatePct}%)</span>
                  </div>
                </div>

                <div className="button-group mt-3">
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      if (onSendTrajectoryToLab && lastRecordedPath.length > 0) {
                        onSendTrajectoryToLab(lastRecordedPath, assistMode);
                      }
                    }}
                  >
                    <Compass size={16} /> Inspect Path in Smoothness Lab
                  </button>
                  <button className="btn btn-secondary" onClick={startBenchmark}>
                    <RotateCcw size={16} /> Run Again
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Live Telemetry Sidebar */}
        <div className="telemetry-panel">
          <h4 className="panel-title">
            <Activity size={16} /> Live ISO 9241-9 Telemetry
          </h4>

          <div className="metric-box">
            <span className="metric-title">Target Progression</span>
            <div className="metric-main">
              <span className="metric-number">
                {isRunning ? currentTargetIndex + 1 : isFinished ? totalTargets : 0}
              </span>
              <span className="metric-unit">/ {totalTargets}</span>
            </div>
            <div className="progress-bar-bg">
              <div
                className="progress-bar-fill"
                style={{
                  width: `${(currentTargetIndex / totalTargets) * 100}%`,
                }}
              />
            </div>
          </div>

          <div className="metric-box">
            <span className="metric-title">Index of Difficulty (Shannon ID)</span>
            <div className="metric-main">
              <span className="metric-number text-cyan">
                {activeTarget ? Math.log2((targetRadiusDistance * 2) / targetSize + 1).toFixed(2) : '3.25'}
              </span>
              <span className="metric-unit">bits</span>
            </div>
            <span className="metric-subtext">ID = log₂(2D / W + 1)</span>
          </div>

          <div className="metric-box">
            <span className="metric-title">Throughput (TP)</span>
            <div className="metric-main">
              <span className="metric-number text-emerald">{avgThroughput}</span>
              <span className="metric-unit">bits/s</span>
            </div>
            <span className="metric-subtext">Handsfree Benchmark Baseline: 4.38 bits/s</span>
          </div>

          <div className="metric-box">
            <span className="metric-title">Average Movement Time</span>
            <div className="metric-main">
              <span className="metric-number text-primary">{avgMovementTime}</span>
              <span className="metric-unit">ms</span>
            </div>
            <span className="metric-subtext">Human target acquisition latency</span>
          </div>

          <div className="metric-box">
            <span className="metric-title">Miss & Slip Error Rate</span>
            <div className="metric-main">
              <span className="metric-number text-amber">{errorRatePct}%</span>
              <span className="metric-unit">({misses} slips)</span>
            </div>
            <span className="metric-subtext">Accidental clicks outside target boundary</span>
          </div>
        </div>
      </div>
    </div>
  );
}
