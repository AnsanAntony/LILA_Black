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
  const [isZoomEnabled, setIsZoomEnabled] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(4.0); // 2x Zoom
  const [zoomCenter, setZoomCenter] = useState({ x: 50, y: 50 }); // Percentage-based
  const [isDragging, setIsDragging] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const zoomCanvasRef = useRef(null); // Add this ref
  const [mapImage, setMapImage] = useState(null); // Replace your old loading logic
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const matchStats = useMemo(() => {
    if (!parquetData) return null;
    const stats = {
      humans: new Set(),
      movingBots: new Set(),
      pvpKills: 0,       // Event: Kill
      botDeaths: 0,      // Event: BotKill (Human kills bot)
      playerDeaths: 0,   // Event: BotKilled (Bot kills human)
      stormKills: 0,     // Event: KilledByStorm
      lootCount: 0,      // Event: Loot
      posHistory: {}     // To track BotPosition movement
    };

    parquetData.forEach(row => {
      const id = row[2];
      const x = row[4];
      const y = row[5];
      const event = String(row[7] || "");

      // 1. Entity & Movement Tracking
      if (event === "BotPosition") {
        if (!stats.posHistory[id]) stats.posHistory[id] = { x, y };
        else if (Math.abs(stats.posHistory[id].x - x) > 1 || Math.abs(stats.posHistory[id].y - y) > 1) {
          stats.movingBots.add(id);
        }
      } else if (["Position", "Kill", "Killed", "BotKill", "BotKilled", "Loot"].includes(event)) {
        if (id && !id.includes('Bot')) stats.humans.add(id);
      }

      // 2. Event Counting
      switch (event) {
        case "Kill": stats.pvpKills++; break;
        case "BotKill": stats.botDeaths++; break;
        case "BotKilled": stats.playerDeaths++; break;
        case "KilledByStorm": stats.stormKills++; break;
        case "Loot": stats.lootCount++; break;
        default: break;
      }
    });

    return {
      humanCount: stats.humans.size,
      movingBotCount: stats.movingBots.size,
      pvpKills: stats.pvpKills,
      botDeaths: stats.botDeaths,
      playerDeathsToBots: stats.playerDeaths,
      stormKills: stats.stormKills,
      lootCount: stats.lootCount
    };
  }, [parquetData]);

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
    if (isZoomEnabled && parquetData) {
      const config = MAP_CONFIGS[selectedMap];
      // We reverse the data to find the "latest" position relative to the current time
      const currentPlayerPos = [...parquetData].reverse().find(row =>
        row[6] * 1000 <= currentTime && row[7]?.includes('Position') && !row[7]?.includes('Bot')
      );

      if (currentPlayerPos) {
        const u = (currentPlayerPos[3] - config.originX) / config.scale;
        const v = 1 - ((currentPlayerPos[5] - config.originZ) / config.scale);
        setZoomCenter({ x: u * 100, y: v * 100 });
      }
    }
  }, [currentTime, isZoomEnabled, parquetData, selectedMap]);

  useEffect(() => {
    const img = new Image();
    img.src = new URL(`./assets/minimaps/${selectedMap}_Minimap.${MAP_CONFIGS[selectedMap].ext}`, import.meta.url).href;
    img.onload = () => {
      setMapImage(img);
      setIsImageLoaded(true);
    };
  }, [selectedMap]);

  // useEffect(() => {
  //   if (!parquetData || !canvasRef.current || !mapImage || !isImageLoaded) return;
  //   const canvas = canvasRef.current;
  //   const ctx = canvas.getContext('2d');
  //   const config = MAP_CONFIGS[selectedMap];

  //   ctx.clearRect(0, 0, 1024, 1024);
  //   ctx.drawImage(mapImage, 0, 0, 1024, 1024);

  //   // 2. Draw Points
  //   parquetData.forEach(row => {
  //     const ts = row[6] * 1000;
  //     const event = String(row[7] || "");
  //     const x = row[3];
  //     const z = row[5];

  //     if (ts <= currentTime) {
  //       let shouldDraw = false;
  //       let color = 'white';
  //       let size = 2;

  //       // ... keep your existing if/else filter logic here ...
  //       if (event.includes('Position') && !event.includes('Bot')) {
  //         if (filters.showHumanMove) { shouldDraw = true; color = '#00FF00'; size = 2; }
  //       } else if (event.includes('BotPosition')) {
  //         if (filters.showBotMove) { shouldDraw = true; color = '#FFFFFF'; size = 2; }
  //       } else if (event.includes('Kill') || event.includes('Killed')) {
  //         if (event.includes('Bot')) {
  //           if (filters.showBotCombat) { shouldDraw = true; color = '#FF4500'; size = 8; }
  //         } else {
  //           if (filters.showPvP) { shouldDraw = true; color = '#FFFF00'; size = 8; }
  //         }
  //       } else if (event.includes('KilledByStorm')) {
  //         if (filters.showEnv) { shouldDraw = true; color = '#FF00FF'; size = 10; }
  //       } else if (event.includes('Loot')) {
  //         if (filters.showLoot) { shouldDraw = true; color = '#00FFFF'; size = 4; }
  //       }

  //       if (shouldDraw) {
  //         const u = (x - config.originX) / config.scale;
  //         const v = (z - config.originZ) / config.scale;
  //         ctx.beginPath();
  //         ctx.fillStyle = color;
  //         ctx.arc(u * 1024, (1 - v) * 1024, size, 0, Math.PI * 2);
  //         ctx.fill();
  //       }
  //     }
  //   });

  //   // 3. Draw Lens
  //   if (isZoomEnabled) {
  //     const lensSize = 250;
  //     ctx.strokeStyle = '#4caf50';
  //     ctx.lineWidth = 4;
  //     ctx.strokeRect(20, 20, 300, 300);

  //     ctx.save();
  //     ctx.beginPath();
  //     ctx.rect(20, 20, 300, 300);
  //     ctx.clip();
  //     ctx.drawImage(
  //       canvas,
  //       mousePos.x - (lensSize / 2), mousePos.y - (lensSize / 2), lensSize, lensSize,
  //       20, 20, 300, 300
  //     );
  //     ctx.restore();
  //   }
  // }, [parquetData, filters, selectedMap, currentTime, isZoomEnabled, mousePos, mapImage]);

  useEffect(() => {
    if (!parquetData || !canvasRef.current || !mapImage || !isImageLoaded) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const config = MAP_CONFIGS[selectedMap];

    // 1. Draw Map & Dots on Main Canvas
    ctx.clearRect(0, 0, 1024, 1024);
    ctx.drawImage(mapImage, 0, 0, 1024, 1024);

    parquetData.forEach(row => {
      const ts = row[6] * 1000;
      const event = String(row[7] || "");
      const x = row[3];
      const z = row[5];

      if (ts <= currentTime) {
        let shouldDraw = false;
        let color = 'white';
        let size = 2;

        // Filter logic
        if (event.includes('Position') && !event.includes('Bot')) {
          if (filters.showHumanMove) { shouldDraw = true; color = '#00FF00'; size = 2; }
        } else if (event.includes('BotPosition')) {
          if (filters.showBotMove) { shouldDraw = true; color = '#FFFFFF'; size = 2; }
        } else if (event.includes('Kill') || event.includes('Killed')) {
          if (event.includes('Bot')) {
            if (filters.showBotCombat) { shouldDraw = true; color = '#FF4500'; size = 8; }
          } else {
            if (filters.showPvP) { shouldDraw = true; color = '#FFFF00'; size = 8; }
          }
        } else if (event.includes('KilledByStorm')) {
          if (filters.showEnv) { shouldDraw = true; color = '#FF00FF'; size = 10; }
        } else if (event.includes('Loot')) {
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

    // 2. Draw zoomed section to the SEPARATE window
    if (isZoomEnabled && zoomCanvasRef.current) {
      const zoomCtx = zoomCanvasRef.current.getContext('2d');
      const lensSize = 250;

      // Clear and draw the zoomed portion from the main canvas to the zoom canvas
      zoomCtx.clearRect(0, 0, 300, 300);
      zoomCtx.drawImage(
        canvas,
        mousePos.x - (lensSize / 2),
        mousePos.y - (lensSize / 2),
        lensSize, lensSize, // Source: grabbed from main canvas
        0, 0, 300, 300      // Destination: stretched to fit the 300x300 zoom window
      );
    }
  }, [parquetData, filters, selectedMap, currentTime, isZoomEnabled, mousePos, mapImage, isImageLoaded]);
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
          <h3><a href="https://github.com/AnsanAntony/LILA_Black" target="_blank" rel="noopener noreferrer">
  GitHub Link
</a></h3>
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
                {[1.0, 2.0, 10.0, 20.0, 30.0, 40.0].map(speed => (
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

            {/* 4. Layers (Existing) */}
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

            {/* 5. Camera (New Line added) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', borderLeft: '1px solid #444', paddingLeft: '20px' }}>
              <label><strong>5. Camera</strong></label>
              <button onClick={() => setIsZoomEnabled(!isZoomEnabled)} style={{ padding: '4px 8px', fontSize: '11px', background: isZoomEnabled ? '#2196F3' : '#333', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}>
                {isZoomEnabled ? "DISABLE ZOOM" : "ENABLE ZOOM (FOLLOW)"}
              </button>
            </div>

            {/* 6. Game Stats (New Line added) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', borderLeft: '1px solid #444', paddingLeft: '20px' }}>
              <label><strong>6. Game Stats</strong></label>
              <div style={{ display: 'flex', gap: '10px', fontSize: '11px', background: '#000', padding: '4px 10px', borderRadius: '4px', height: '24px', alignItems: 'center', border: '1px solid #444', whiteSpace: 'nowrap' }}>
                {matchStats ? (
                  <>
                    <span style={{ color: '#fefffe' }}>Players: {matchStats.humanCount}</span>
                    <span style={{ color: '#fefffe' }}>Bots (Live): {matchStats.movingBotCount}</span>
                    <span style={{ color: '#fefffe' }}>PvP: {matchStats.pvpKills}</span>
                    <span style={{ color: '#fefffe' }}>BotDeaths: {matchStats.botDeaths}</span>
                    <span style={{ color: '#fefffe' }}>PlayerLost: {matchStats.playerDeathsToBots}</span>
                    <span style={{ color: '#fefffe' }}>Storm: {matchStats.stormKills}</span>
                    <span style={{ color: '#fefffe' }}>Loot: {matchStats.lootCount}</span>
                  </>
                ) : (
                  <span style={{ color: '#666' }}>No telemetry loaded</span>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {!parquetData ? (
        <div style={{ width: '90vh', maxWidth: '100%', aspectRatio: '1/1', background: '#181818', borderRadius: '12px', border: '2px dashed #333', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#666' }}>
          <div style={{ fontSize: '48px', marginBottom: '10px' }}>📄</div>
          <p style={{ margin: 0, fontWeight: '500' }}>Waiting for the telemetry document...</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', justifyContent: 'center', marginTop: '20px' }}>
            <div style={{ display: isZoomEnabled ? 'block' : 'none' }}>
              <h4 style={{ margin: '0 0 5px 0', fontSize: '12px', color: '#4caf50' }}>DETAIL VIEW</h4>
              <div style={{ width: '300px', height: '300px', background: '#000', border: '2px solid #4caf50', borderRadius: '8px', overflow: 'hidden' }}>
                <canvas ref={zoomCanvasRef} width="300" height="300" style={{ width: '100%', height: '100%' }} />
              </div>
            </div>
            <div onMouseMove={(e) => { const rect = e.currentTarget.getBoundingClientRect(); setMousePos({ x: ((e.clientX - rect.left) / rect.width) * 1024, y: ((e.clientY - rect.top) / rect.height) * 1024 }); }}
              style={{ position: 'relative', width: '90vh', maxWidth: '100%', aspectRatio: '1/1', background: '#000', borderRadius: '8px', border: '2px solid #333', overflow: 'hidden', cursor: 'crosshair' }}
            >
              <canvas ref={canvasRef} width="1024" height="1024" style={{ width: '100%', height: '100%' }} />
            </div>
          </div>

          {/* Legend added back here */}
          <div style={{ display: 'flex', gap: '20px', marginTop: '20px', padding: '15px', background: '#1e1e1e', borderRadius: '8px', width: '100%', maxWidth: 'calc(90vh + 320px)', justifyContent: 'center', flexWrap: 'wrap' }}>
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
}

export default App;