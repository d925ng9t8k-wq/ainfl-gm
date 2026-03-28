import React, { useState } from 'react';
import { useNbaGame } from '../context/NbaGameContext';

export default function NbaScenarioManager() {
  const { savedScenarios, activeScenarioName, saveScenario, loadScenario, deleteScenario } = useNbaGame();
  const [open, setOpen] = useState(false);
  const [inputName, setInputName] = useState('');

  function handleSave() {
    const name = inputName.trim() || `Scenario ${savedScenarios.length + 1}`;
    saveScenario(name);
    setInputName('');
    setOpen(false);
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(255,160,0,0.2)',
          borderRadius: 6, padding: '4px 10px', color: '#FFA500', fontSize: 11,
          cursor: 'pointer', fontFamily: "'Oswald', system-ui, sans-serif",
          letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 600,
        }}
      >
        Scenarios {activeScenarioName ? `(${activeScenarioName.substring(0, 8)})` : ''}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '110%', left: 0, zIndex: 200,
          background: '#0F172A', border: '1px solid rgba(255,160,0,0.2)',
          borderRadius: 8, padding: 12, minWidth: 220,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}>
          <div style={{ fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
            Saved Scenarios
          </div>
          {savedScenarios.length === 0 && (
            <div style={{ fontSize: 12, color: '#475569', marginBottom: 10 }}>No saved scenarios</div>
          )}
          {savedScenarios.map(s => (
            <div key={s.name} style={{
              display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
              padding: '4px 8px', borderRadius: 6,
              background: s.name === activeScenarioName ? 'rgba(255,160,0,0.1)' : 'transparent',
            }}>
              <button
                onClick={() => { loadScenario(s.name); setOpen(false); }}
                style={{ flex: 1, background: 'none', border: 'none', color: '#E2E8F0', fontSize: 12, cursor: 'pointer', textAlign: 'left', padding: 0 }}
              >
                {s.name}
              </button>
              <button
                onClick={() => deleteScenario(s.name)}
                style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 14, padding: 0 }}
              >
                &times;
              </button>
            </div>
          ))}
          <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
            <input
              value={inputName}
              onChange={e => setInputName(e.target.value)}
              placeholder="Scenario name..."
              style={{
                flex: 1, background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(255,160,0,0.2)',
                borderRadius: 4, padding: '4px 8px', color: '#E2E8F0', fontSize: 12,
                outline: 'none',
              }}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
            <button
              onClick={handleSave}
              style={{
                background: 'rgba(255,160,0,0.2)', border: '1px solid rgba(255,160,0,0.3)',
                borderRadius: 4, color: '#FFA500', fontSize: 12, cursor: 'pointer',
                padding: '4px 10px', fontWeight: 700,
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
