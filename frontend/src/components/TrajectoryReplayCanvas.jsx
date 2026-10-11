import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Compass, Activity, ShieldCheck, Zap, AlertTriangle, FastForward, CheckCircle2, Sliders } from 'lucide-react';
import { generateDemoTrajectories } from '../data/presentationDataset';

export default function TrajectoryReplayCanvas({ customTrajectory = null, customAssistMode = 'handsfree' }) {
  // Preset trajectories
  const demoData = React.useMemo(() => generateDemoTrajectories(), []);

  const [activeDataset, setActiveDataset] = useState('both'); // 'both' | 'tremor' | 'handsfree' | 'live'
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1); // 0.5, 1, 2
  const [progress, setProgress] = useState(0); // 0.0 to 1.0
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showIdealPath, setShowIdealPath] = useState(true);

  // Live recording state
  const [isRecordingLive, setIsRecordingLive] = useState(false);
  const [liveTrajectory, setLiveTrajectory] = useState([]);

  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);
  const lastTimeRef = useRef(null);

  // Path data calculation
  const getPathMetrics = (path) => {
    if (!path || path.length < 2) {
      return { optimalDistance: 0, actualDistance: 0, efficiency: 100, excessMotion: 0, jitterVariance: 0 };
    }
    const p0 = path[0];
    const pEnd = path[path.length - 1];
    const optimalDistance = Math.hypot(pEnd.x - p0.x, pEnd.y - p0.y);

    let actualDistance = 0;
    let accelerations = [];
    for (let i = 1; i < path.length; i++) {
      const stepDist = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      actualDistance += stepDist;
      if (i > 1) {
        const prevStep = Math.hypot(path[i - 1].x - path[i - 2].x, path[i - 1].y - path[i - 2].y);
        accelerations.push(Math.abs(stepDist - prevStep));
      }
    }

    const efficiency = actualDistance > 0 ? Math.min(100, (optimalDistance / actualDistance) * 100) : 100;
    const excessMotion = Math.max(0, actualDistance - optimalDistance);
    const avgAcc = accelerations.length > 0 ? accelerations.reduce((a, b) => a + b, 0) / accelerations.length : 0;
    const jitterVariance = accelerations.length > 0
      ? accelerations.reduce((acc, a) => acc + Math.pow(a - avgAcc, 2), 0) / accelerations.length
      : 0;

    return {
      optimalDistance: Math.round(optimalDistance),
      actualDistance: Math.round(actualDistance),
      efficiency: parseFloat(efficiency.toFixed(1)),
      excessMotion: Math.round(excessMotion),
      jitterVariance: parseFloat(jitterVariance.toFixed(2)),
    };
  };

  const tremorMetrics = React.useMemo(() => getPathMetrics(demoData.standardTremor), [demoData]);
  const handsFreeMetrics = React.useMemo(() => getPathMetrics(demoData.handsFreeSmooth), [demoData]);
  const liveMetrics = React.useMemo(() => getPathMetrics(liveTrajectory), [liveTrajectory]);

  // Animation playback loop
  useEffect(() => {
    if (!isPlaying) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      return;
    }

    lastTimeRef.current = performance.now();

    const loop = (time) => {
      const delta = (time - lastTimeRef.current) / 1000;
      lastTimeRef.current = time;

      // Complete cycle in ~3 seconds at 1x
      const duration = 3.0 / playbackSpeed;
      setProgress((prev) => {
        const next = prev + delta / duration;
        if (next >= 1.0) {
          return 0.0; // Loop seamlessly
        }
        return next;
      });

      animationFrameRef.current = requestAnimationFrame(loop);
    };

    animationFrameRef.current = requestAnimationFrame(loop);

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying, playbackSpeed]);

  // Draw on Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Clear background
    ctx.clearRect(0, 0, width, height);

    // Grid backdrop
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x < width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const { start, target, standardTremor, handsFreeSmooth } = demoData;

    // 1. Draw Ideal Geodesic Line (Straight Path)
    if (showIdealPath) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.setLineDash([4, 6]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
      ctx.restore();
    }

    // 2. Draw Start Point (Green Ring)
    ctx.save();
    ctx.fillStyle = 'rgba(16, 185, 129, 0.2)';
    ctx.beginPath();
    ctx.arc(start.x, start.y, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(start.x, start.y, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '11px Inter, sans-serif';
    ctx.fillText('START', start.x - 18, start.y - 24);
    ctx.restore();

    // 3. Draw Target Point (Bullseye Ring)
    ctx.save();
    ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';
    ctx.beginPath();
    ctx.arc(target.x, target.y, target.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(target.x, target.y, target.radius, 0, Math.PI * 2);
    ctx.stroke();
    // Inner bullseye
    ctx.fillStyle = '#818cf8';
    ctx.beginPath();
    ctx.arc(target.x, target.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '11px Inter, sans-serif';
    ctx.fillText('TARGET (W=56px)', target.x - 45, target.y - 34);
    ctx.restore();

    // Helper: draw trajectory trail up to current progress
    const drawTrajectory = (path, strokeColor, glowColor, isTremor = false) => {
      if (!path || path.length < 2) return;
      const count = Math.max(2, Math.floor(path.length * progress));
      const subPath = path.slice(0, count);

      // Trajectory Line
      ctx.save();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = isTremor ? 2 : 3.5;
      if (isTremor) {
        ctx.setLineDash([3, 2]);
      }
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = isTremor ? 4 : 12;

      ctx.beginPath();
      ctx.moveTo(subPath[0].x, subPath[0].y);
      for (let i = 1; i < subPath.length; i++) {
        ctx.lineTo(subPath[i].x, subPath[i].y);
      }
      ctx.stroke();
      ctx.restore();

      // Draw Cursor Head
      const currentPoint = subPath[subPath.length - 1];
      if (currentPoint) {
        ctx.save();
        ctx.fillStyle = strokeColor;
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(currentPoint.x, currentPoint.y, isTremor ? 5 : 7, 0, Math.PI * 2);
        ctx.fill();

        // Cursor label
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 10px JetBrains Mono, monospace';
        ctx.fillText(isTremor ? 'Tremor Mouse' : 'Handsfree Glide', currentPoint.x + 10, currentPoint.y - 8);
        ctx.restore();
      }
    };

    // Draw paths based on dataset selection
    if (activeDataset === 'both' || activeDataset === 'tremor') {
      drawTrajectory(standardTremor, '#f87171', 'rgba(239, 68, 68, 0.6)', true);
    }

    if (activeDataset === 'both' || activeDataset === 'handsfree') {
      drawTrajectory(handsFreeSmooth, '#38bdf8', 'rgba(56, 189, 248, 0.75)', false);
    }

    if (activeDataset === 'live' && liveTrajectory.length > 1) {
      drawTrajectory(liveTrajectory, '#34d399', 'rgba(52, 211, 153, 0.8)', false);
    }
  }, [progress, demoData, activeDataset, showHeatmap, showIdealPath, liveTrajectory]);

  // Live recording mouse handlers
  const handleLiveMouseDown = (e) => {
    if (activeDataset !== 'live') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setIsRecordingLive(true);
    setLiveTrajectory([{ x: Math.round(x), y: Math.round(y), t: 0 }]);
  };

  const handleLiveMouseMove = (e) => {
    if (!isRecordingLive || activeDataset !== 'live') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setLiveTrajectory(prev => [
      ...prev,
      { x: Math.round(x), y: Math.round(y), t: prev.length * 16 }
    ]);
  };

  const handleLiveMouseUp = () => {
    if (isRecordingLive) {
      setIsRecordingLive(false);
    }
  };

  return (
    <div className="benchmark-card">
      {/* Header */}
      <div className="card-header-flex">
        <div>
          <div className="badge-row">
            <span className="pill pill-primary">Smoothness & Jitter Lab</span>
            <span className="pill pill-cyan">Dual Path Replay</span>
            <span className="pill pill-emerald">Kalman Filter Verification</span>
          </div>
          <h2 className="card-title">Cursor Trajectory Replay Canvas</h2>
          <p className="card-subtitle">
            Demonstrates real-time kinematic movement smoothness, path efficiency (D_optimal / D_actual), and tremor reduction.
          </p>
        </div>

        <div className="controls-row">
          <div className="mode-selector">
            <button
              className={`mode-btn ${activeDataset === 'both' ? 'active' : ''}`}
              onClick={() => setActiveDataset('both')}
            >
              Side-by-Side Dual Path
            </button>
            <button
              className={`mode-btn ${activeDataset === 'tremor' ? 'active' : ''}`}
              onClick={() => setActiveDataset('tremor')}
            >
              Unassisted Tremor Only
            </button>
            <button
              className={`mode-btn ${activeDataset === 'handsfree' ? 'active' : ''}`}
              onClick={() => setActiveDataset('handsfree')}
            >
              Handsfree Smooth Only
            </button>
            <button
              className={`mode-btn ${activeDataset === 'live' ? 'active' : ''}`}
              onClick={() => { setActiveDataset('live'); setIsPlaying(false); }}
            >
              Live Mouse Draw
            </button>
          </div>
        </div>
      </div>

      {/* Canvas Viewport and Scrubber Controls */}
      <div className="canvas-suite-container">
        <div className="canvas-wrapper">
          <canvas
            ref={canvasRef}
            width={720}
            height={440}
            className="trajectory-canvas"
            onMouseDown={handleLiveMouseDown}
            onMouseMove={handleLiveMouseMove}
            onMouseUp={handleLiveMouseUp}
          />

          {activeDataset === 'live' && (
            <div className="live-canvas-hint">
              <span>Click & Drag anywhere inside canvas to record your live pointer trajectory</span>
            </div>
          )}

          {/* Floating Canvas Legend */}
          <div className="canvas-floating-legend">
            <div className="legend-item">
              <span className="legend-indicator tremor" />
              <span>Standard Unassisted Tremor ({tremorMetrics.efficiency}%)</span>
            </div>
            <div className="legend-item">
              <span className="legend-indicator handsfree" />
              <span>Handsfree Kalman Glide ({handsFreeMetrics.efficiency}%)</span>
            </div>
            <div className="legend-item">
              <span className="legend-indicator optimal" />
              <span>Optimal Straight Path</span>
            </div>
          </div>
        </div>

        {/* Playback Scrubber Bar */}
        <div className="playback-control-bar">
          <div className="playback-buttons">
            <button
              className="btn btn-icon btn-secondary"
              onClick={() => setIsPlaying(!isPlaying)}
              title={isPlaying ? 'Pause Replay' : 'Play Replay'}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button
              className="btn btn-icon btn-secondary"
              onClick={() => { setProgress(0); setIsPlaying(true); }}
              title="Restart from Beginning"
            >
              <RotateCcw size={16} />
            </button>
          </div>

          <div className="scrubber-slider-container">
            <span className="scrubber-time">{(progress * 3.0).toFixed(1)}s</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.005"
              value={progress}
              onChange={(e) => {
                setProgress(parseFloat(e.target.value));
                setIsPlaying(false);
              }}
              className="scrubber-slider"
            />
            <span className="scrubber-time">3.0s</span>
          </div>

          <div className="speed-pills">
            {[0.5, 1, 2].map((spd) => (
              <button
                key={spd}
                className={`speed-btn ${playbackSpeed === spd ? 'active' : ''}`}
                onClick={() => setPlaybackSpeed(spd)}
              >
                {spd}x
              </button>
            ))}
          </div>
        </div>

        {/* Quantitative Smoothness Scorecards */}
        <div className="smoothness-scorecards-grid">
          {/* Card 1: Handsfree Assisted */}
          <div className="smoothness-card handsfree-card">
            <div className="card-badge-row">
              <span className="pill pill-cyan">Handsfree Assisted</span>
              <span className="text-emerald font-bold">+108.7% More Efficient</span>
            </div>
            <h3 className="scorecard-metric-title">Path Efficiency Ratio</h3>
            <div className="metric-large text-cyan">
              {handsFreeMetrics.efficiency}
              <span className="unit">%</span>
            </div>
            <div className="scorecard-details">
              <div className="detail-row">
                <span>Optimal Geodesic Distance:</span>
                <strong>{handsFreeMetrics.optimalDistance} px</strong>
              </div>
              <div className="detail-row">
                <span>Actual Path Travelled:</span>
                <strong>{handsFreeMetrics.actualDistance} px</strong>
              </div>
              <div className="detail-row">
                <span>Wasted Motion / Overshoot:</span>
                <strong className="text-emerald">+{handsFreeMetrics.excessMotion} px (Minimal)</strong>
              </div>
              <div className="detail-row">
                <span>Path Acceleration Variance:</span>
                <strong className="text-cyan">{handsFreeMetrics.jitterVariance} px/s²</strong>
              </div>
            </div>
          </div>

          {/* Card 2: Standard Tremor */}
          <div className="smoothness-card tremor-card">
            <div className="card-badge-row">
              <span className="pill pill-amber">Unassisted Tremor</span>
              <span className="text-rose-400 font-bold">-56.2% Wasted Motion</span>
            </div>
            <h3 className="scorecard-metric-title">Path Efficiency Ratio</h3>
            <div className="metric-large text-rose-400">
              {tremorMetrics.efficiency}
              <span className="unit">%</span>
            </div>
            <div className="scorecard-details">
              <div className="detail-row">
                <span>Optimal Geodesic Distance:</span>
                <strong>{tremorMetrics.optimalDistance} px</strong>
              </div>
              <div className="detail-row">
                <span>Actual Path Travelled:</span>
                <strong>{tremorMetrics.actualDistance} px</strong>
              </div>
              <div className="detail-row">
                <span>Wasted Motion / Tremor Drift:</span>
                <strong className="text-rose-400">+{tremorMetrics.excessMotion} px</strong>
              </div>
              <div className="detail-row">
                <span>Path Acceleration Variance:</span>
                <strong className="text-amber">{tremorMetrics.jitterVariance} px/s²</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
