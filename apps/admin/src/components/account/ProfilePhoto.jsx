import { useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Camera } from 'lucide-react';
import api, { apiError } from '../../lib/api';
import useAuthStore from '../../stores/authStore';
import Avatar from '../ui/Avatar';

export function mediaUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  const base = import.meta.env.VITE_API_BASE_URL || '';
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (/^https?:\/\//i.test(base)) {
    return `${base.replace(/\/api\/v1\/?$/, '')}${normalized}`;
  }
  return normalized;
}

export function useProfilePhoto() {
  const inputRef = useRef(null);
  const user = useAuthStore((s) => s.user);
  const persist = useAuthStore((s) => s.persist);
  const [busy, setBusy] = useState(false);
  const src = mediaUrl(user?.avatarUrl);

  const saveUser = (next) => {
    const token = localStorage.getItem('token');
    if (token && next) persist(token, next);
  };

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const body = new FormData();
    body.append('image', file);
    setBusy(true);
    try {
      const { data } = await api.post('/auth/me/avatar', body);
      saveUser(data.data);
      toast.success('Profile photo updated');
    } catch (err) {
      toast.error(apiError(err, 'Could not update the photo'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const { data } = await api.delete('/auth/me/avatar');
      saveUser(data.data);
      toast.success('Profile photo removed');
    } catch (err) {
      toast.error(apiError(err, 'Could not remove the photo'));
    } finally {
      setBusy(false);
    }
  };

  return {
    src,
    busy,
    hasPhoto: Boolean(user?.avatarUrl),
    pick: () => inputRef.current?.click(),
    input: (
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={onFile}
      />
    ),
    remove,
  };
}

export function ProfileAvatar({ src, name, className }) {
  const initials = (name || 'U')
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return <Avatar src={src} alt={name || 'Profile'} fallback={initials} className={className} />;
}

export function ProfilePhotoButton({ name, className = 'h-9 w-9' }) {
  const photo = useProfilePhoto();
  return (
    <div className="relative">
      {photo.input}
      <button
        type="button"
        className="relative rounded-full"
        onClick={photo.pick}
        disabled={photo.busy}
        title="Change photo"
      >
        <ProfileAvatar src={photo.src} name={name} className={className} />
        <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-700 text-white">
          <Camera className="h-2.5 w-2.5" />
        </span>
      </button>
    </div>
  );
}
