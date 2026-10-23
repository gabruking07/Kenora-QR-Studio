import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeft, Check, Copy, Download, ExternalLink, ImagePlus, LoaderCircle, LockKeyhole, Plus, Share2, Trash2, Upload, Video, X } from 'lucide-react';
import api from './api';

const base = api.defaults.baseURL;
const expiryLabels = { '1h': '1 hour', '6h': '6 hours', '24h': '24 hours', '3d': '3 days', '7d': '7 days' };
const prettySize = n => n < 1048576 ? `${Math.ceil(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const publicUrl = token => `${location.origin}/media/${token}`;
const videoFile = file => file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(file.name);
const imageFile = file => file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(file.name);

function useNotice() { const [notice, setNotice] = useState(''); const show = message => { setNotice(message); setTimeout(() => setNotice(''), 4500); }; return [notice, show]; }

function ShareCard({ share, refresh, show }) {
  const [password, setPassword] = useState(''); const [expiry, setExpiry] = useState('24h'); const url = publicUrl(share.token); const status = share.status;
  const copy = async () => { await navigator.clipboard.writeText(url); show('Share link copied.'); };
  const shareNative = async () => { if (navigator.share) { try { await navigator.share({ title: share.title, url }); } catch {} } else copy(); };
  const revoke = async () => { if (confirm('Revoke this link now? Friends will lose access immediately.')) { await api.post(`/media/shares/${share.id}/revoke`); refresh(); } };
  const deletePermanently = async () => { if (confirm('Permanently delete this share and its Cloudinary files? This cannot be undone.')) { await api.delete(`/media/shares/${share.id}`); refresh(); } };
  const savePassword = async e => { e.preventDefault(); await api.patch(`/media/shares/${share.id}`, { password }); setPassword(''); show('Album password updated.'); };
  const retention = async action => { if (action === 'delete' && !confirm('Permanently delete all files for this expired album? This cannot be undone.')) return; try { const r = await api.post(`/media/shares/${share.id}/retention`, { action }); show(r.data.message); refresh(); } catch (e) { show(e.response?.data?.message || 'Some files could not be deleted. Retry the delete action.'); } };
  return <article className="media-share-card"><div className="media-share-top"><div><span className={`media-status ${status}`}>{status}</span><h3>{share.title}</h3><p>{share.fileCount} files · {prettySize(share.totalBytes)} · Created {new Date(share.createdAt).toLocaleDateString()}</p><p>Expires {new Date(share.expiresAt).toLocaleString()}</p></div><QRCodeSVG value={url} size={86} level="M"/></div><div className="media-link"><a href={url} target="_blank" rel="noreferrer">{url}</a><button onClick={copy} aria-label="Copy share link"><Copy size={16}/></button><button onClick={shareNative} aria-label="Share link"><Share2 size={16}/></button></div><div className="media-actions">{status === 'active' && <><button className="outline" onClick={revoke}>Revoke link</button><form onSubmit={savePassword}><input type="password" minLength="8" maxLength="100" required placeholder="Set a new password" aria-label="New album password" value={password} onChange={e => setPassword(e.target.value)}/><button className="outline" type="submit">Change password</button></form><select aria-label="Change expiry" value={expiry} onChange={e => setExpiry(e.target.value)}>{Object.entries(expiryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><button className="outline" onClick={saveExpiry}>Update expiry</button></>}{status === 'expired' && share.retention === 'pending' && <><button className="outline" onClick={() => retention('keep')}>Keep files</button><button className="danger-button" onClick={() => retention('delete')}>Delete permanently</button></>}{(status === 'revoked' || status === 'expired') && share.retention === 'keep' && <span className="media-note">Files retained in Cloudinary.</span>}<button className="danger-button" onClick={deletePermanently}><Trash2 size={15}/> Delete share</button></div></article>;
}

function MediaDashboard() {
  const [shares, setShares] = useState([]); const [form, setForm] = useState({ title: '', description: '', password: '', expiry: '24h' }); const [busy, setBusy] = useState(false); const [message, show] = useNotice(); const [items, setItems] = useState([]); const [files, setFiles] = useState([]); const [lastShare, setLastShare] = useState(null); const aborts = useRef(new Map()); const previewUrls = useRef([]); const navigate = useNavigate();
  const refresh = async () => { try { const r = await api.get('/media/shares'); setShares(r.data.data.shares); } catch (e) { show(e.response?.data?.message || 'Could not load your shares.'); } };
  useEffect(() => { refresh(); }, []);
  const chooseFiles = e => { const selected = [...e.target.files]; previewUrls.current.forEach(url => URL.revokeObjectURL(url)); previewUrls.current = selected.filter(f => imageFile(f)).map(f => URL.createObjectURL(f)); let previewIndex = 0; setFiles(selected); setItems(selected.map(f => ({ file: f, preview: imageFile(f) ? previewUrls.current[previewIndex++] : '', status: 'ready', progress: 0 }))); }; useEffect(() => () => previewUrls.current.forEach(url => URL.revokeObjectURL(url)), []);
  const uploadOne = async (share, file, index) => {
    setItems(current => current.map((x, i) => i === index ? { ...x, status: 'preparing', error: '', shareId: share.id } : x));
    let pendingId;
    try {
      const resourceType = videoFile(file) ? 'video' : 'image';
      const init = await api.post(`/media/shares/${share.id}/uploads/initiate`, { fileName: file.name, resourceType, sizeBytes: file.size, mimeType: file.type || '' });
      pendingId = init.data.data.uploadId;
      const sig = init.data.data.cloudinary; const body = new FormData(); body.append('file', file); body.append('api_key', sig.apiKey); body.append('timestamp', sig.timestamp); body.append('signature', sig.signature); body.append('public_id', sig.publicId); body.append('type', sig.type); body.append('overwrite', String(sig.overwrite)); body.append('allowed_formats', sig.allowedFormats);
      const controller = new AbortController(); aborts.current.set(index, { controller, shareId: share.id, pendingId });
      setItems(current => current.map((x, i) => i === index ? { ...x, status: 'uploading', pendingId, shareId: share.id } : x));
      await axios.post(`https://api.cloudinary.com/v1_1/${sig.cloudName}/${sig.resourceType}/upload`, body, { signal: controller.signal, onUploadProgress: event => { if (event.total) setItems(current => current.map((x, i) => i === index ? { ...x, progress: Math.round(event.loaded / event.total * 100) } : x)); } });
      await api.post(`/media/shares/${share.id}/uploads/${pendingId}/complete`);
      setItems(current => current.map((x, i) => i === index ? { ...x, status: 'complete', progress: 100 } : x));
      aborts.current.delete(index);
    } catch (e) {
      if (pendingId) await api.delete(`/media/shares/${share.id}/uploads/${pendingId}`).catch(() => {});
      setItems(current => current.map((x, i) => i === index ? { ...x, status: e.code === 'ERR_CANCELED' ? 'cancelled' : 'failed', error: e.response?.data?.message || (e.code === 'ERR_CANCELED' ? 'Cancelled' : 'Upload failed. Retry this file.') } : x));
      aborts.current.delete(index);
    }
  };
  const create = async e => {
    e.preventDefault(); if (!files.length) { show('Choose at least one photo or video.'); return; }
    setBusy(true);
    try {
      const created = await api.post('/media/shares', form); const share = created.data.data.share; setLastShare(share);
      for (let i = 0; i < files.length; i++) await uploadOne(share, files[i], i);
      await refresh(); setForm({ title: '', description: '', password: '', expiry: '24h' });
      show(`Album created. Share link: ${publicUrl(share.token)}`); navigate('/media', { replace: true });
    } catch (e) { show(e.response?.data?.message || 'Could not create the album.'); }
    finally { setBusy(false); }
  };
  const retry = item => { const share = shares.find(s => s.id === item.shareId) || lastShare; if (share) uploadOne(share, item.file, items.indexOf(item)); };
  const active = items.some(x => ['uploading', 'preparing'].includes(x.status));
  return <main className="page media-page"><div className="pagehead"><div><p className="eyebrow">PRIVATE ALBUM LINKS</p><h1>Media sharing</h1></div><span className="media-usage">Cloudinary Free limits: photos 10 MB · videos 100 MB each</span></div><p className="lead media-intro">Create password-protected albums for photos and videos. Your friends can open a link without an account.</p>{message && <div className="media-notice" role="status">{message}</div>}<section className="media-create"><p className="eyebrow"><Plus size={15}/> NEW ALBUM</p><h2>Create a share</h2><form onSubmit={create}><label>Album title<input required minLength="2" maxLength="100" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Weekend in the mountains"/></label><label>Description (optional)<textarea maxLength="1000" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Add a note for your friends"/></label><div className="media-form-row"><label>Album password<input required type="password" minLength="8" maxLength="100" autoComplete="new-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters"/></label><label>Link expires<select value={form.expiry} onChange={e => setForm({ ...form, expiry: e.target.value })}>{Object.entries(expiryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div><label className="media-file-label"><ImagePlus size={19}/> <span><b>Select photos and videos</b><small>JPG, PNG, WebP, GIF, AVIF, HEIC, MP4, MOV, M4V, WebM · up to 100 files / 2 GB total</small></span><input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,video/mp4,video/quicktime,video/x-m4v,video/webm" onChange={chooseFiles}/></label>{items.length > 0 && <div className="media-file-list">{items.map((item, i) => <div className="media-file-row" key={`${item.file.name}-${i}`}><span>{item.preview ? <img className='media-thumb' src={item.preview} alt=''/> : videoFile(item.file) ? <Video size={16}/> : <ImagePlus size={16}/>}</span><div><b>{item.file.name}</b><small>{prettySize(item.file.size)} · {item.status === 'uploading' ? `Uploading ${item.progress}%` : item.status}</small>{item.error && <small className="formerror">{item.error}</small>}{item.status === 'uploading' && <progress max="100" value={item.progress}/>}</div>{item.status === 'uploading' && <button type="button" onClick={() => aborts.current.get(i)?.controller.abort()} aria-label={`Cancel ${item.file.name}`}><X size={16}/></button>}{item.status === 'failed' && <button type="button" onClick={() => retry(item)}>Retry</button>}{item.status === 'complete' && <Check size={17}/>}</div>)}</div>}<p className="media-cost-note">Cloudinary Free includes 25 shared credits for storage, transformations, and delivery. Views and downloads use bandwidth; no unlimited storage or downloads.</p><button className="button" type="submit" disabled={busy || active}><Upload size={16}/>{busy ? 'Creating and uploading…' : 'Create album and upload'}</button></form></section><section className="media-list-section"><div className="media-section-head"><div><p className="eyebrow">YOUR ALBUMS</p><h2>My shares</h2></div><button className="outline" onClick={refresh}>Refresh</button></div>{shares.length ? <div className="media-share-list">{shares.map(share => <ShareCard key={share.id} share={share} refresh={refresh} show={show}/>)}</div> : <div className="empty"><h2>No albums yet</h2><p>Your media shares will appear here with links, QR codes, expiry, and storage details.</p></div>}</section></main>;
}

function PublicAlbum() {
  const { token } = useParams(); const [password, setPassword] = useState(''); const [grant, setGrant] = useState(''); const [album, setAlbum] = useState(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [ticket, setTicket] = useState('');
  const load = async value => { const result = await api.get(`/media/public/${token}`, { headers: { Authorization: `Bearer ${value}` } }); setAlbum(result.data.data); setGrant(value); };
  const unlock = async e => { e.preventDefault(); setBusy(true); setError(''); try { const r = await api.post(`/media/public/${token}/verify-password`, { password }); await load(r.data.data.grant); } catch (e) { setError(e.response?.data?.message || 'Could not open this album.'); } finally { setBusy(false); } };
  const downloadZip = async () => { try { const r = await api.get(`/media/public/${token}/download-all/ticket`, { headers: { Authorization: `Bearer ${grant}` } }); setTicket(`${base.replace(/\/api\/?$/, '')}${r.data.data.url}`); } catch (e) { setError(e.response?.data?.message || 'Could not prepare the ZIP.'); } };
  useEffect(() => { if (ticket) { const a = document.createElement('a'); a.href = ticket; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); setTicket(''); } }, [ticket]);
  return <main className="public-album"><header><Link className="brand" to="/"><img src="/assets/Kenora QR Studio.png"/><span>KENORA<br/>QR STUDIO</span></Link><span>Private album</span></header>{!album ? <section className="unlock-card"><LockKeyhole size={28}/><p className="eyebrow">PASSWORD-PROTECTED SHARE</p><h1>Open album</h1><p>Enter the password shared with you to view these photos and videos.</p><form onSubmit={unlock}><label>Album password<input required type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)}/></label>{error && <p className="formerror" role="alert">{error}</p>}<button className="button" disabled={busy}>{busy ? 'Checking…' : 'Unlock album'}</button></form><small>Album access is temporary and does not require an account.</small></section> : <section className="album-content"><div className="album-heading"><div><p className="eyebrow">SHARED ALBUM</p><h1>{album.title}</h1>{album.description && <p>{album.description}</p>}</div><div className="album-actions">{album.files.length > 0 && <button className="button" onClick={downloadZip}><Download size={16}/> Download all as ZIP</button>}<button className="outline" onClick={() => { setAlbum(null); setGrant(''); setPassword(''); setError(''); }}>Lock album</button></div></div>{album.files.length ? <div className="album-grid">{album.files.map(asyncFile => <AlbumFile key={asyncFile.id} file={asyncFile} token={token} grant={grant}/>)}</div> : <div className="empty"><h2>This album is empty</h2></div>}{error && <p className="formerror">{error}</p>}</section>}</main>;
}

function AlbumFile({ file, token, grant }) {
  const [url, setUrl] = useState(''); const [error, setError] = useState(''); const video = file.resourceType === 'video';
  useEffect(() => { api.get(`/media/public/${token}/files/${file.id}/access`, { headers: { Authorization: `Bearer ${grant}` } }).then(r => setUrl(r.data.data.url)).catch(() => setError('Preview unavailable')); }, [token, file.id, grant]);
  const download = async () => { try { const r = await api.get(`/media/public/${token}/files/${file.id}/access?download=1`, { headers: { Authorization: `Bearer ${grant}` } }); location.assign(r.data.data.url); } catch { setError('Download could not be prepared. Unlock the album again.'); } };
  return <article className="album-file">{url ? (video ? <video src={url} controls preload="metadata" playsInline aria-label={file.originalName}/> : <img src={url} alt={file.originalName} loading="lazy"/>) : <div className="album-placeholder">{error || <LoaderCircle className="spin"/>}</div>}<div><b>{file.originalName}</b><small>{prettySize(file.sizeBytes)}</small>{url && <button type="button" onClick={download}><Download size={15}/> Download original</button>}</div></article>;
}

export { MediaDashboard, PublicAlbum };
