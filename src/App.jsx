import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactFlow, { 
  Background, 
  Controls, 
  applyNodeChanges, 
  applyEdgeChanges, 
  Handle, 
  Position,
  MarkerType,
  ReactFlowProvider 
} from 'reactflow';
import 'reactflow/dist/style.css';
import axios from 'axios';
import dagre from 'dagre';
import './App.css';

const nodeWidth = 200;
const nodeHeight = 80;

// ऑटोमैटिक ट्री लेआउट: ऊपर माता-पिता, नीचे बच्चे
const getLayoutedElements = (nodes, edges) => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 90 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      targetPosition: Position.Top,
      sourcePosition: Position.Bottom,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
};

// कस्टम नोड: ऊपर और नीचे दोनों तरफ हैंडल + डिलीट बटन
const PersonNode = ({ data, id }) => {
  return (
    <div className="custom-node" onClick={() => data.onSelect(data.person)}>
      <button 
        className="delete-btn" 
        title="हटाएं"
        onClick={(e) => {
          e.stopPropagation();
          data.onDelete(id, data.person.name);
        }}
      >
        ✕
      </button>

      {/* 🔼 ऊपर वाला हरा बिंदु: माता-पिता से कनेक्शन के लिए */}
      <Handle 
        type="target" 
        id="top-target"
        position={Position.Top} 
        style={{ background: '#10b981', width: 12, height: 12, top: -6 }} 
      />
      <Handle 
        type="source" 
        id="top-source"
        position={Position.Top} 
        style={{ background: '#10b981', width: 12, height: 12, top: -6 }} 
      />

      <img 
        src={data.person.avatar_url || 'https://via.placeholder.com/150'} 
        alt={data.person.name} 
        className="node-avatar" 
      />
      <div className="node-info">
        <h4>{data.person.name}</h4>
        <p>{data.person.profession || data.person.current_city || 'Family Member'}</p>
      </div>

      {/* 🔽 नीचे वाला नीला बिंदु: संतान की तरफ कनेक्शन के लिए */}
      <Handle 
        type="source" 
        id="bottom-source"
        position={Position.Bottom} 
        style={{ background: '#2563eb', width: 12, height: 12, bottom: -6 }} 
      />
    </div>
  );
};

const nodeTypes = { personNode: PersonNode };

function TreeFlow() {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedPerson, setSelectedPerson] = useState(null);
  
  const [relationMode, setRelationMode] = useState(null);
  const [activePerson, setActivePerson] = useState(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    gender: 'M',
    profession: '',
    current_city: '',
    native_place: '',
    bio: ''
  });
  const [photoFile, setPhotoFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);

  const dragConnection = useRef({ nodeId: null, handleId: null });

  useEffect(() => {
    fetchFamilyTree();
  }, []);

  const fetchFamilyTree = async () => {
    try {
      const res = await axios.get(' https://family-tree-backend-cgyj.onrender.com');
      const persons = res.data.persons || [];

      const rawNodes = persons.map((p) => ({
        id: String(p.id),
        type: 'personNode',
        data: { 
          person: p, 
          onSelect: setSelectedPerson,
          onDelete: handleDeletePerson 
        },
        position: { x: 0, y: 0 },
      }));

      // यही है वह rawEdges जहाँ हमने साफ़ तीर (Arrow) जोड़ा है
      const rawEdges = [];
      persons.forEach((p) => {
        if (p.parent_ids && Array.isArray(p.parent_ids)) {
          p.parent_ids.forEach((parent_id) => {
            rawEdges.push({
              id: `edge-${parent_id}-${p.id}`,
              source: String(parent_id),
              target: String(p.id),
              type: 'smoothstep',
              animated: true,
              style: { 
                stroke: '#2563eb', 
                strokeWidth: 2.5 
              },
              markerEnd: {
                type: MarkerType.ArrowClosed,
                width: 18,
                height: 18,
                color: '#2563eb',
              },
            });
          });
        }
      });

      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(rawNodes, rawEdges);
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
    } catch (err) {
      console.error('Error fetching tree:', err);
    }
  };

  const handleDeletePerson = async (id, name) => {
    if (!window.confirm(`क्या आप सच में "${name}" को हटाना चाहते हैं?`)) return;
    try {
      await axios.delete(` https://family-tree-backend-cgyj.onrender.com/api/person${id}`);
      fetchFamilyTree();
    } catch (error) {
      alert('सदस्य हटाने में त्रुटि आई!');
    }
  };

  const onConnectStart = useCallback((_, { nodeId, handleId }) => {
    dragConnection.current = { nodeId, handleId };
  }, []);

  const onConnectEnd = useCallback((event) => {
    const { nodeId, handleId } = dragConnection.current;
    if (!nodeId) return;

    const targetIsPane = event.target.classList.contains('react-flow__pane');
    if (targetIsPane) {
      const node = nodes.find(n => n.id === nodeId);
      if (node) {
        setActivePerson(node.data.person);
        setRelationMode(handleId?.includes('top') ? 'parent' : 'child');
        setIsFormOpen(true);
      }
    }
  }, [nodes]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name) return alert('कृपया नाम दर्ज करें!');

    setIsUploading(true);
    const body = new FormData();
    body.append('name', formData.name);
    body.append('gender', formData.gender);
    body.append('profession', formData.profession || '');
    body.append('current_city', formData.current_city || '');
    body.append('native_place', formData.native_place || '');
    body.append('bio', formData.bio || '');

    if (relationMode === 'child' && activePerson) {
      body.append('parent_ids', JSON.stringify([String(activePerson.id)]));
    }

    if (photoFile) {
      body.append('photo', photoFile);
    }

    try {
      const res = await axios.post('http://family-tree-backend-cygyj.onrender.com/api/person', body);
      
      if (relationMode === 'parent' && activePerson) {
        const created = res.data?.person;
        const newParentId = Array.isArray(created) ? created[0]?.id : created?.id;
        
        if (newParentId) {
          const formUpdate = new FormData();
          formUpdate.append('parent_id', String(newParentId));
          await axios.put(`http://family-tree-backend-cygyj.onrender.com/api/person/${activePerson.id}/add-parent`, formUpdate);
        }
      }

      setIsFormOpen(false);
      setFormData({ name: '', gender: 'M', profession: '', current_city: '', native_place: '', bio: '' });
      setPhotoFile(null);
      setActivePerson(null);
      setRelationMode(null);
      fetchFamilyTree();
    } catch (error) {
      console.error('Error adding person:', error);
      alert('सदस्य जोड़ने में त्रुटि आई!');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#f8fafc', position: 'fixed', top: 0, left: 0 }}>
      <button 
        onClick={() => {
          setActivePerson(null);
          setRelationMode(null);
          setIsFormOpen(true);
        }}
        style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          zIndex: 100,
          background: '#2563eb',
          color: 'white',
          border: 'none',
          padding: '10px 20px',
          borderRadius: '50px',
          fontWeight: 'bold',
          cursor: 'pointer',
          boxShadow: '0 4px 14px rgba(37, 99, 235, 0.3)'
        }}
      >
        + अलग सदस्य जोड़ें
      </button>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={(changes) => setNodes((nds) => applyNodeChanges(changes, nds))}
        onEdgesChange={(changes) => setEdges((eds) => applyEdgeChanges(changes, eds))}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        fitView
      >
        <Background gap={16} size={1} />
        <Controls />
      </ReactFlow>

      {/* फॉर्म पॉपअप */}
      {isFormOpen && (
        <div className="modal-overlay" onClick={() => setIsFormOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '85vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 6px 0', color: '#1e293b' }}>
              {relationMode === 'parent' 
                ? `⬆️ "${activePerson?.name}" के माता/पिता जोड़ें`
                : relationMode === 'child'
                ? `⬇️ "${activePerson?.name}" की संतान जोड़ें`
                : 'नया परिवार सदस्य जोड़ें'}
            </h3>
            <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#64748b' }}>
              {relationMode === 'parent'
                ? 'यह सदस्य ऊपर जुड़ेगा और नीचे की ओर तीर बनेगा।'
                : relationMode === 'child'
                ? 'यह सदस्य नीचे जुड़ेगा और तीर इस तरफ आएगा।'
                : 'यह एक स्वतंत्र सदस्य के रूप में जुड़ेगा।'}
            </p>
            
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <input 
                type="text" 
                placeholder="पूरा नाम *" 
                value={formData.name} 
                onChange={(e) => setFormData({...formData, name: e.target.value})} 
                style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                required 
              />
              
              <div style={{ display: 'flex', gap: '12px' }}>
                <select 
                  value={formData.gender} 
                  onChange={(e) => setFormData({...formData, gender: e.target.value})}
                  style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                >
                  <option value="M">पुरुष (Male)</option>
                  <option value="F">महिला (Female)</option>
                </select>

                <input 
                  type="text" 
                  placeholder="पेशा" 
                  value={formData.profession} 
                  onChange={(e) => setFormData({...formData, profession: e.target.value})} 
                  style={{ flex: 2, padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <input 
                  type="text" 
                  placeholder="वर्तमान शहर" 
                  value={formData.current_city} 
                  onChange={(e) => setFormData({...formData, current_city: e.target.value})} 
                  style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
                <input 
                  type="text" 
                  placeholder="पैतृक गाँव" 
                  value={formData.native_place} 
                  onChange={(e) => setFormData({...formData, native_place: e.target.value})} 
                  style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
              </div>

              <textarea 
                placeholder="किस्सा या परिचय..." 
                rows="2" 
                value={formData.bio} 
                onChange={(e) => setFormData({...formData, bio: e.target.value})} 
                style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', resize: 'none' }}
              />

              <div>
                <label style={{ fontSize: '12px', color: '#475569', display: 'block', marginBottom: '4px' }}>
                  फ़ोटो चुनें:
                </label>
                <input 
                  type="file" 
                  accept="image/*" 
                  onChange={(e) => setPhotoFile(e.target.files[0])} 
                  style={{ fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button 
                  type="submit" 
                  disabled={isUploading}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: '#2563eb',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: 'bold'
                  }}
                >
                  {isUploading ? 'जोड़ रहे हैं...' : 'ट्री में जोड़ें'}
                </button>
                <button 
                  type="button" 
                  onClick={() => setIsFormOpen(false)}
                  style={{
                    padding: '10px 16px',
                    background: '#e2e8f0',
                    color: '#334155',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer'
                  }}
                >
                  रद्द करें
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* प्रोफाइल डिटेल कार्ड */}
      {selectedPerson && (
        <div className="modal-overlay" onClick={() => setSelectedPerson(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <img 
                src={selectedPerson.avatar_url || 'https://via.placeholder.com/150'} 
                alt="" 
                style={{ width: '70px', height: '70px', borderRadius: '50%', objectFit: 'cover' }} 
              />
              <div>
                <h2 style={{ margin: 0 }}>{selectedPerson.name}</h2>
                <span style={{ color: '#64748b', fontSize: '14px' }}>
                  {selectedPerson.profession || 'सदस्य'}
                </span>
              </div>
            </div>

            <div style={{ marginTop: '16px', fontSize: '14px', lineHeight: '1.6', color: '#334155' }}>
              <p><strong>📍 वर्तमान शहर:</strong> {selectedPerson.current_city || 'उपलब्ध नहीं'}</p>
              <p><strong>🏡 पैतृक गांव:</strong> {selectedPerson.native_place || 'उपलब्ध नहीं'}</p>
              <p><strong>📖 परिचय:</strong> {selectedPerson.bio || 'कोई विवरण नहीं'}</p>
            </div>

            <button 
              onClick={() => setSelectedPerson(null)}
              style={{
                width: '100%',
                padding: '10px',
                marginTop: '12px',
                background: '#0f172a',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer'
              }}
            >
              बंद करें
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <TreeFlow />
    </ReactFlowProvider>
  );
}
