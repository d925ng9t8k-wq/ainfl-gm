import React, { useState, useRef, useEffect } from 'react';
import { useGame } from '../context/GameContext';

export default function ScenarioManager() {
  const { savedScenarios, activeScenarioName, saveScenario, loadScenario, deleteScenario } = useGame();
  const [isOpen, setIsOpen] = useState(false);
  const [scenarioName, setScenarioName] = useState('');
  const panelRef = useRef(null);

  // Close panel on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  function handleSave() {
    const name = scenarioName.trim();
    if (!name) return;
    saveScenario(name);
    setScenarioName('');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSave();
  }

  return (
    <div ref={panelRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(prev => !prev)}
        title="Save / Load Scenarios"
        style={{
          background: isOpen ? 'rgba(0,240,255,0.15)' : 'rgba(30,41,59,0.6)',
          border: `1px solid ${isOpen ? 'rgba(0,240,255,0.4)' : 'rgba(0,240,255,0.15)'}`,
          borderRadius: 6,
          padding: '4px 8px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          color: '#94A3B8',
          fontSize: 12,
          transition: 'all 0.2s ease',
        }}
      >
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
        <span style={{
          fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          fontSize: 11,
          fontWeight: 600,
        }}>
          {activeScenarioName || 'Scenarios'}
        </span>
        {savedScenarios.length > 0 && (
          <span style={{
            background: 'rgba(0,240,255,0.2)',
            color: '#00F0FF',
            borderRadius: 8,
            padding: '0 5px',
            fontSize: 10,
            fontWeight: 700,
            lineHeight: '16px',
          }}>{savedScenarios.length}</span>
        )}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div style={{
          position: 'fixed',
          top: 64,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 300,
          maxWidth: 'calc(100vw - 24px)',
          background: 'rgba(10, 22, 40, 0.97)',
          border: '1px solid rgba(0,240,255,0.25)',
          borderRadius: 10,
          boxShadow: '0 4px 30px rgba(0,0,0,0.6), 0 0 20px rgba(0,240,255,0.1)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          zIndex: 200,
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(0,240,255,0.12), rgba(195,0,255,0.08))',
            padding: '10px 12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div style={{
              color: '#00F0FF',
              fontWeight: 700,
              fontSize: 12,
              fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}>
              Saved Scenarios
            </div>
            <span style={{ color: '#64748B', fontSize: 10 }}>{savedScenarios.length}/5</span>
          </div>

          {/* Scenario list */}
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {savedScenarios.length === 0 && (
              <div style={{ padding: '16px 12px', textAlign: 'center', color: '#64748B', fontSize: 12 }}>
                No saved scenarios yet. Save your current plan below.
              </div>
            )}
            {savedScenarios.map(s => (
              <div
                key={s.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '8px 12px',
                  borderBottom: '1px solid rgba(0,240,255,0.06)',
                  background: s.name === activeScenarioName ? 'rgba(0,240,255,0.06)' : 'transparent',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    color: s.name === activeScenarioName ? '#00F0FF' : '#E2E8F0',
                    fontSize: 13,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>{s.name}</div>
                  <div style={{ color: '#64748B', fontSize: 10, marginTop: 1 }}>
                    {s.teamAbbr} &middot; {new Date(s.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </div>
                </div>
                <button
                  onClick={() => { loadScenario(s.name); setIsOpen(false); }}
                  style={{
                    background: 'rgba(0,240,255,0.1)',
                    color: '#00D4FF',
                    border: '1px solid rgba(0,240,255,0.2)',
                    borderRadius: 4,
                    padding: '3px 8px',
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    marginRight: 4,
                  }}
                >Load</button>
                <button
                  onClick={() => deleteScenario(s.name)}
                  title="Delete scenario"
                  style={{
                    background: 'none',
                    color: '#64748B',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '2px 4px',
                    fontSize: 14,
                    lineHeight: 1,
                  }}
                >
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {/* Save new */}
          <div style={{
            padding: '10px 12px',
            borderTop: '1px solid rgba(0,240,255,0.1)',
            display: 'flex',
            gap: 6,
          }}>
            <input
              type="text"
              value={scenarioName}
              onChange={e => setScenarioName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Scenario name..."
              maxLength={30}
              disabled={savedScenarios.length >= 5 && !savedScenarios.some(s => s.name === scenarioName.trim())}
              style={{
                flex: 1,
                background: 'rgba(30,41,59,0.6)',
                color: '#E2E8F0',
                border: '1px solid rgba(0,240,255,0.15)',
                borderRadius: 6,
                padding: '6px 8px',
                fontSize: 12,
                fontFamily: "'Inter', system-ui, sans-serif",
                outline: 'none',
                minWidth: 0,
              }}
            />
            <button
              onClick={handleSave}
              disabled={!scenarioName.trim()}
              style={{
                background: scenarioName.trim() ? 'linear-gradient(135deg, #00D4FF, #00A0CC)' : 'rgba(30,41,59,0.6)',
                color: scenarioName.trim() ? '#000' : '#64748B',
                border: 'none',
                borderRadius: 6,
                padding: '6px 12px',
                fontWeight: 700,
                fontSize: 11,
                fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                cursor: scenarioName.trim() ? 'pointer' : 'not-allowed',
                whiteSpace: 'nowrap',
              }}
            >Save</button>
          </div>
        </div>
      )}
    </div>
  );
}
