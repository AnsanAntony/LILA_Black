import React, { useState, useEffect, useRef, useMemo } from 'react';
import { parquetRead } from 'hyparquet';

const App = () => {
  const MAP_CONFIGS = {
    AmbroseValley: { scale: 900, originX: -370, originZ: -473, ext: 'png' },
    GrandRift: { scale: 581, originX: -290, originZ: -290, ext: 'png' },
    Lockdown: { scale: 1000, originX: -500, originZ: -500, ext: 'jpg' }
  };

  const [selectedMap, setSelectedMap] = useState('AmbroseValley');
  const [filters, setFilters] = useState({
    showHumanMove: true,
    showBotMove: true,
    showPvP: true,
    showBotCombat: true,
    showEnv: true,
    showLoot: true
  });

  const formatTime = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;

    // Helper to ensure numbers look like "05" instead of "5"
    const pad = (num) => String(num).padStart(2, '0');

    // Returns format: 0h 00m 00s
    return `${h}h ${pad(m)}m ${pad(s)}s`;
  };

  const [status, setStatus] = useState('System Ready');
  const [parquetData, setParquetData] = useState(null);
  const [matchMetadata, setMatchMetadata] = useState({ mapName: 'Unknown', startTime: null, formattedDate: '' });
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

  const canvasRef = useRef(null);

  const timeRange = useMemo(() => {
    if (!parquetData || parquetData.length === 0) return { min: 0, max: 0 };
    const timestamps = parquetData.map(r => r[6] * 1000);
    return { min: Math.min(...timestamps), max: Math.max(...timestamps) };
  }, [parquetData]);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setStatus(`Processing ${file.name}...`);
    setIsPlaying(false);

    try {
      const arrayBuffer = await file.arrayBuffer();
      await parquetRead({
        file: arrayBuffer,
        onComplete: (data) => {
          if (data.length > 0) {
            const minTs = Math.min(...data.map(r => r[6])) * 1000;
            const detectedMap = data[0][2];

            setMatchMetadata({
              mapName: detectedMap,
              startTime: minTs,
              formattedDate: new Date(minTs).toLocaleString()
            });

            if (MAP_CONFIGS[detectedMap]) setSelectedMap(detectedMap);
            setCurrentTime(minTs);
            setParquetData(data);
            setStatus(`Successfully loaded ${data.length} points.`);
          }
        }
      });
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
  };

  const handleFilterChange = (e) => {
    const { id, checked } = e.target;
    setFilters(prev => ({ ...prev, [id]: checked }));
  };

  useEffect(() => {
    let interval;
    if (isPlaying && currentTime < timeRange.max) {
      interval = setInterval(() => {
        setCurrentTime(prev => {
          // Speed updated from 50 to 100
          const next = prev + (100 * playbackSpeed);
          if (next >= timeRange.max) {
            setIsPlaying(false);
            return timeRange.max;
          }
          return next;
        });
      }, 100);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isPlaying, currentTime, timeRange.max, playbackSpeed]);

  useEffect(() => {
    if (!parquetData || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const config = MAP_CONFIGS[selectedMap];
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    parquetData.forEach(row => {
      const ts = row[6] * 1000;
      const event = String(row[7] || "");
      const x = row[3];
      const z = row[5];

      if (ts <= currentTime) {
        let shouldDraw = false;
        let color = 'white';
        let size = 2;

        if (event.includes('Position') && !event.includes('Bot')) {
          if (filters.showHumanMove) { shouldDraw = true; color = '#00FF00'; size = 2; }
        }
        else if (event.includes('BotPosition')) {
          if (filters.showBotMove) { shouldDraw = true; color = '#FFFFFF'; size = 2; }
        }
        else if (event.includes('Kill') || event.includes('Killed')) {
          if (event.includes('Bot')) {
            if (filters.showBotCombat) { shouldDraw = true; color = '#FF4500'; size = 8; }
          } else {
            if (filters.showPvP) { shouldDraw = true; color = '#FFFF00'; size = 8; }
          }
        }
        else if (event.includes('KilledByStorm')) {
          if (filters.showEnv) { shouldDraw = true; color = '#FF00FF'; size = 10; }
        }
        else if (event.includes('Loot')) {
          if (filters.showLoot) { shouldDraw = true; color = '#00FFFF'; size = 4; }
        }

        if (shouldDraw) {
          const u = (x - config.originX) / config.scale;
          const v = (z - config.originZ) / config.scale;
          ctx.beginPath();
          ctx.fillStyle = color;
          ctx.arc(u * 1024, (1 - v) * 1024, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
  }, [parquetData, filters, selectedMap, currentTime]);

  const isMatchEnded = currentTime >= timeRange.max && parquetData;

  const handleMainButtonClick = () => {
    if (isMatchEnded) {
      setCurrentTime(timeRange.min);
      setIsPlaying(false);
    } else {
      setIsPlaying(!isPlaying);
    }
  };

  return (
    <div style={{
      background: '#121212', color: '#e0e0e0', padding: '20px', fontFamily: 'Inter, sans-serif',
      minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center'
    }}>
      <header style={{ width: '100%', maxWidth: '1200px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '1px solid #333', paddingBottom: '10px', marginBottom: '20px' }}>
        <div>
          <h2 style={{ margin: 0, letterSpacing: '1px' }}>LILA BLACK | Replay Analytics</h2>
          <small style={{ color: '#4caf50', fontWeight: 'bold' }}>{status}</small>
        </div>
        {parquetData && (
          <div style={{ textAlign: 'right' }}>
            <h3 style={{ margin: 0, color: '#4caf50' }}>{matchMetadata.mapName}</h3>
            <div style={{ fontSize: '12px', color: '#888' }}>{matchMetadata.formattedDate}</div>
          </div>
        )}
      </header>

      <div style={{ width: '100%', maxWidth: '1200px', display: 'flex', gap: '20px', flexWrap: 'wrap', background: '#1e1e1e', padding: '15px', borderRadius: '8px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <label><strong>1. Source File</strong></label>
          <input type="file" onChange={handleFileChange} style={{ fontSize: '12px' }} />
        </div>

        {parquetData && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label><strong>2. Speed</strong></label>
              <div style={{ display: 'flex', gap: '5px' }}>
                {[1.0, 2.0, 4.0, 6.0, 10.0, 20.0].map(speed => (
                  <button key={speed} onClick={() => setPlaybackSpeed(speed)}
                    style={{ padding: '4px 8px', fontSize: '11px', background: playbackSpeed === speed ? '#4caf50' : '#333', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    {speed === 1.0 ? "Real" : `${speed}x`}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', flex: 1 }}>
              <label><strong>3. Timeline</strong></label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button onClick={handleMainButtonClick} style={{ width: '90px', padding: '5px', background: isMatchEnded ? '#2196F3' : (isPlaying ? '#ff4444' : '#4caf50'), border: 'none', color: '#fff', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
                  {isMatchEnded ? "↺ RESET" : (isPlaying ? "⏸ PAUSE" : "▶ PLAY")}
                </button>
                <input type="range" min={timeRange.min} max={timeRange.max} value={currentTime} onChange={(e) => setCurrentTime(Number(e.target.value))} style={{ flex: 1, cursor: 'pointer' }} />
                <span style={{ fontSize: '12px', width: '80px', textAlign: 'right', fontFamily: 'monospace' }}>
                  {Math.floor((currentTime - timeRange.min) / 1000)}s
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label><strong>4. Layers</strong></label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {Object.entries(filters).map(([key, value]) => (
                  <label key={key} style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                    <input type="checkbox" id={key} checked={value} onChange={handleFilterChange} />
                    {key.replace('show', '')}
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {!parquetData ? (
        <div style={{
          width: '90vh', maxWidth: '100%', aspectRatio: '1/1', background: '#181818',
          borderRadius: '12px', border: '2px dashed #333', display: 'flex',
          flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#666'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '10px' }}>📄</div>
          <p style={{ margin: 0, fontWeight: '500' }}>Waiting for the telemetry document...</p>
        </div>
      ) : (
        <>
          <div style={{
            position: 'relative', width: '90vh', maxWidth: '100%', aspectRatio: '1/1',
            background: '#000', borderRadius: '8px', border: '2px solid #333', overflow: 'hidden'
          }}>
            <img
              src={new URL(`./assets/minimaps/${selectedMap}_Minimap.${MAP_CONFIGS[selectedMap].ext}`, import.meta.url).href}
              style={{ width: '100%', height: '100%', opacity: 0.6, objectFit: 'contain' }}
              alt="minimap"
            />
            <canvas ref={canvasRef} width="1024" height="1024" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
          </div>

          <div style={{ display: 'flex', gap: '15px', marginTop: '20px', padding: '15px', background: '#1e1e1e', borderRadius: '8px', width: '100%', maxWidth: '90vh', justifyContent: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px' }}><div style={{ width: 8, height: 8, background: '#00FF00', borderRadius: '50%' }} /> Player</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px' }}><div style={{ width: 8, height: 8, background: '#FFFFFF', borderRadius: '50%' }} /> Bot</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px' }}><div style={{ width: 8, height: 8, background: '#FFFF00', borderRadius: '50%' }} /> PvP Kill</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px' }}><div style={{ width: 8, height: 8, background: '#FF4500', borderRadius: '50%' }} /> Bot Kill</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px' }}><div style={{ width: 8, height: 8, background: '#FF00FF', borderRadius: '50%' }} /> Env/Storm</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px' }}><div style={{ width: 8, height: 8, background: '#00FFFF', borderRadius: '50%' }} /> Loot</div>
          </div>
        </>
      )}
    </div>
  );
};

export default App;