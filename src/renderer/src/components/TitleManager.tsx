import React, { useState, useRef, useEffect } from 'react'
import { useStore } from '../store/useStore'

export default function TitleManager() {
  const { 
    templates, 
    titles, 
    createTemplate, 
    updateTemplate, 
    cloneTemplate, 
    deleteTemplate, 
    removeTitle, 
    availableFonts,
    settings,
    updateSettings,
    setTitleResolution
  } = useStore()
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(templates[0]?.id || null)

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState<'move' | 'resize' | null>(null)

  const handleCanvasInteraction = (e: React.MouseEvent) => {
    if (!selectedTemplate || !containerRef.current || !isDragging) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100

    if (isDragging === 'move') {
      updateTemplate(selectedTemplate.id, {
        box: { ...selectedTemplate.box, x: Math.max(0, x), y: Math.max(0, y) }
      })
    } else if (isDragging === 'resize') {
      updateTemplate(selectedTemplate.id, {
        box: { 
          ...selectedTemplate.box, 
          width: Math.max(5, x - selectedTemplate.box.x), 
          height: Math.max(5, y - selectedTemplate.box.y) 
        }
      })
    }
  }

  const stopDragging = () => setIsDragging(null)

  return (
    <div className="flex-1 flex overflow-hidden bg-[#0f1117]" onMouseMove={handleCanvasInteraction} onMouseUp={stopDragging}>
      {/* Sidebar: Templates */}
      <div className="w-64 border-r border-gray-800 flex flex-col">
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Templates</h2>
          <button onClick={() => createTemplate('New Template')} className="text-blue-400 hover:text-blue-300 text-lg">+</button>
        </div>
        
        {/* Global Settings in Sidebar */}
        <div className="p-4 border-b border-gray-800 space-y-4 bg-gray-900/20">
          <div>
            <label className="block text-[10px] text-gray-500 mb-1 uppercase font-bold">Project Resolution</label>
            <select 
              value={settings.titleResolution}
              onChange={(e) => setTitleResolution(e.target.value as any)}
              className="w-full bg-gray-800 border border-gray-700 rounded p-1.5 text-xs text-gray-300"
            >
              <option value="1080p">1080p (1920x1080)</option>
              <option value="4k">4K (3840x2160)</option>
              <option value="720p">720p (1280x720)</option>
              <option value="vertical">Vertical (1080x1920)</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 mb-1 uppercase font-bold">Default Duration (s)</label>
            <input 
              type="number"
              step="0.5"
              value={settings.defaultTitleDuration}
              onChange={(e) => updateSettings({ defaultTitleDuration: Number(e.target.value) })}
              className="w-full bg-gray-800 border border-gray-700 rounded p-1.5 text-xs text-gray-300"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {templates.map(t => (
            <div 
              key={t.id}
              onClick={() => setSelectedTemplateId(t.id)}
              className={`px-3 py-2 rounded-lg cursor-pointer transition-colors flex items-center justify-between group ${
                selectedTemplateId === t.id ? 'bg-blue-600/20 text-blue-300' : 'text-gray-400 hover:bg-gray-800/50'
              }`}
            >
              <span className="truncate text-sm font-medium">{t.name}</span>
              <div className="opacity-0 group-hover:opacity-100 flex items-center gap-2">
                <button onClick={(e) => { e.stopPropagation(); cloneTemplate(t.id) }} className="hover:text-white" title="Clone">⧉</button>
                <button onClick={(e) => { e.stopPropagation(); deleteTemplate(t.id) }} className="hover:text-red-400" title="Delete">✕</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Editor Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedTemplate ? (
          <div className="flex-1 flex flex-col p-6 gap-6 overflow-y-auto bg-[#0f1117]">
            {/* Visual Canvas Preview */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-blue-500 uppercase tracking-widest">Title Canvas Editor</h3>
              <div 
                ref={containerRef}
                className="relative aspect-video bg-black rounded-lg border border-gray-800 shadow-2xl overflow-hidden cursor-crosshair"
                style={{ backgroundImage: 'linear-gradient(45deg, #161922 25%, transparent 25%), linear-gradient(-45deg, #161922 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #161922 75%), linear-gradient(-45deg, transparent 75%, #161922 75%)', backgroundSize: '20px 20px', backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px' }}
              >
                {/* Bounding Box */}
                <div 
                  className="absolute border-2 border-blue-500 bg-blue-500/10 group select-none"
                  style={{
                    left: `${selectedTemplate.box.x}%`,
                    top: `${selectedTemplate.box.y}%`,
                    width: `${selectedTemplate.box.width}%`,
                    height: `${selectedTemplate.box.height}%`,
                  }}
                  onMouseDown={() => setIsDragging('move')}
                >
                  <div className="p-2 h-full flex flex-col pointer-events-none">
                    <span 
                      className="text-white font-bold break-words line-clamp-2"
                      style={{ 
                        fontSize: selectedTemplate.isDynamic ? 'inherit' : `${selectedTemplate.fontSize / 4}px`,
                        textAlign: selectedTemplate.alignment,
                        color: selectedTemplate.color
                      }}
                    >
                      Demo Title Text
                    </span>
                  </div>
                  {/* Resize Handle */}
                  <div 
                    className="absolute bottom-0 right-0 w-4 h-4 bg-blue-500 cursor-nwse-resize"
                    onMouseDown={(e) => { e.stopPropagation(); setIsDragging('resize') }}
                  />
                </div>
              </div>
              <p className="text-[10px] text-gray-500 italic">Drag to move, use bottom-right handle to resize the bounding box.</p>
            </div>

            <div className="grid grid-cols-2 gap-10">
              {/* Styling */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-gray-500 uppercase">Styling</h3>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">Template Name</label>
                  <input 
                    value={selectedTemplate.name} 
                    onChange={e => updateTemplate(selectedTemplate.id, { name: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-gray-200 outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">System Font</label>
                  <select 
                    value={selectedTemplate.fontPath}
                    onChange={e => updateTemplate(selectedTemplate.id, { fontPath: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-gray-200 outline-none focus:border-blue-500"
                  >
                    <option value="">Default Sans-Serif</option>
                    {availableFonts.map(f => <option key={f.path} value={f.path}>{f.name}</option>)}
                  </select>
                </div>
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-[10px] text-gray-500 mb-1">Color</label>
                    <input type="color" value={selectedTemplate.color} onChange={e => updateTemplate(selectedTemplate.id, { color: e.target.value })} className="w-full h-9 bg-gray-800 border border-gray-700 rounded p-1 cursor-pointer" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-[10px] text-gray-500 mb-1">Alignment</label>
                    <select 
                      value={selectedTemplate.alignment}
                      onChange={e => updateTemplate(selectedTemplate.id, { alignment: e.target.value as any })}
                      className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-gray-200"
                    >
                      <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* AI Prompt Section */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-gray-500 uppercase">AI Prompt for this Template</h3>
                <textarea
                  value={selectedTemplate.aiPrompt}
                  onChange={e => updateTemplate(selectedTemplate.id, { aiPrompt: e.target.value })}
                  placeholder="Instructions for AI (e.g. Generate 5 short titles...)"
                  className="w-full h-32 bg-gray-800 border border-gray-700 rounded p-3 text-xs text-gray-300 outline-none focus:border-blue-500 resize-none"
                />
                <p className="text-[10px] text-gray-600 italic">This prompt will be copied along with your transcript to help an AI generate title ideas for this specific style.</p>
              </div>

              {/* Positioning */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-gray-500 uppercase">Bounding Box (Percentage)</h3>
                <div className="grid grid-cols-2 gap-4">
                  {Object.entries(selectedTemplate.box).map(([k, v]) => (
                    <div key={k}>
                      <label className="block text-[10px] text-gray-500 mb-1 uppercase">{k}</label>
                      <input 
                        type="number" value={v} 
                        onChange={e => updateTemplate(selectedTemplate.id, { box: { ...selectedTemplate.box, [k]: Number(e.target.value) } })}
                        className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-gray-200"
                      />
                    </div>
                  ))}
                </div>
                <label className="flex items-center gap-2 cursor-pointer mt-6 p-3 bg-gray-800/30 rounded-lg border border-gray-800">
                  <input 
                    type="checkbox" checked={selectedTemplate.isDynamic}
                    onChange={e => updateTemplate(selectedTemplate.id, { isDynamic: e.target.checked })}
                    className="rounded border-gray-700 bg-gray-800 text-blue-600"
                  />
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-gray-300">Dynamic Font Size</span>
                    <span className="text-[10px] text-gray-500">Automatically scale text to fill the bounding box</span>
                  </div>
                </label>
              </div>
            </div>

            <div className="h-px bg-gray-800" />

            {/* Titles Instance List */}
            <div className="space-y-4">
              <h3 className="text-xs font-bold text-gray-500 uppercase">Titles Applied</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {titles.filter(t => t.templateId === selectedTemplate.id).map(title => (
                  <div key={title.id} className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-200 font-medium truncate italic">"{title.text}"</p>
                      <p className="text-[10px] text-gray-500 mt-1">Timestamp: {new Date(title.startTime * 1000).toISOString().substr(14, 5)}</p>
                    </div>
                    <button onClick={() => removeTitle(title.id)} className="text-gray-500 hover:text-red-400 p-2">✕</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-600 italic">Select a template to start editing</div>
        )}
      </div>
    </div>
  )
}