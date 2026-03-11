import React, { useState, useEffect, useRef, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';
import { 
  LogOut, 
  Search, 
  Plus, 
  Send, 
  Edit2, 
  Trash2, 
  X, 
  MessageSquare, 
  Users, 
  Radio,
  User,
  Check,
  Settings,
  Shield,
  Phone,
  Info,
  Lock,
  Eye,
  EyeOff,
  Clock,
  Smile,
  Reply,
  Forward,
  MoreVertical,
  ChevronDown,
  Pin,
  Link,
  ArrowLeft,
  ShieldCheck,
  Bell,
  BellOff,
  Volume2,
  VolumeX,
  FileText,
  Ban,
  ShieldAlert,
  Globe,
  HardDrive,
  Eraser,
  Bot,
  LayoutGrid,
  CreditCard,
  BarChart2,
  History,
  PlusCircle,
  CheckCircle2,
  DollarSign,
  Languages,
  Wallet
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { generateKeyPair, encryptMessage, decryptMessage } from './services/securityService';

// --- Helpers ---
const safeJsonParse = (str: string | null | undefined, fallback: any = {}) => {
  if (!str || str === 'undefined' || str === 'null') return fallback;
  try {
    return JSON.parse(str);
  } catch (e) {
    console.error("JSON Parse Error:", e, "Input:", str);
    return fallback;
  }
};

// --- Types ---
interface UserData {
  id: number;
  email: string;
  nickname: string;
  username: string;
  phone: string;
  phone_confirmed: boolean;
  two_fa_enabled: boolean;
  bio: string;
  avatar: string;
  last_seen: string;
  privacy_last_seen: 'everyone' | 'contacts' | 'nobody';
  privacy_status: 'everyone' | 'contacts' | 'nobody';
  notification_settings: string; // JSON string
  language?: string;
  balance?: number;
  public_key?: string;
  is_blocked?: boolean;
}

interface Room {
  id: number;
  room_id?: number; // from my_chats
  type: 'private' | 'group' | 'channel' | 'user';
  name: string;
  avatar: string;
  owner_id?: number;
  target_user_id?: number;
  description?: string;
  invite_code?: string;
  pinned_message_id?: number;
  role?: 'owner' | 'admin' | 'member';
  is_muted?: boolean;
  notification_priority?: 'all' | 'mentions' | 'none';
}

interface Message {
  id: number;
  room_id: number;
  sender_id: number;
  nickname: string;
  avatar: string;
  text: string;
  is_edited: boolean;
  reply_to_id?: number;
  forward_from_id?: number;
  reactions?: string; // JSON string
  created_at: string;
}

// --- Components ---

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserData | null>(null);
  const [isAuth, setIsAuth] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isWindowFocused, setIsWindowFocused] = useState(true);

  useEffect(() => {
    const handleFocus = () => setIsWindowFocused(true);
    const handleBlur = () => setIsWindowFocused(false);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  useEffect(() => {
    if (isAuth && currentUser) {
      const checkKeys = async () => {
        const privateKey = localStorage.getItem(`nemessenger_priv_${currentUser.id}`);
        if (!privateKey) {
          const keys = await generateKeyPair();
          localStorage.setItem(`nemessenger_priv_${currentUser.id}`, keys.privateKey);
          await fetch('/api/update_public_key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: currentUser.id, public_key: keys.publicKey }),
          });
        }
      };
      checkKeys();
    }
  }, [isAuth, currentUser]);

  useEffect(() => {
    const savedUser = localStorage.getItem('nemessenger_user');
    if (savedUser) {
      const user = safeJsonParse(savedUser, null);
      if (user) {
        setCurrentUser(user);
        setIsAuth(true);
      }
    }
  }, []);

  useEffect(() => {
    if (isAuth && currentUser) {
      const newSocket = io();
      setSocket(newSocket);
      newSocket.emit('user_connected', currentUser.id);

      return () => {
        newSocket.disconnect();
      };
    }
  }, [isAuth, currentUser]);

  if (!isAuth || !currentUser || !socket) {
    if (!isAuth || !currentUser) {
      return <AuthScreen onAuth={(user) => {
        setCurrentUser(user);
        setIsAuth(true);
        localStorage.setItem('nemessenger_user', JSON.stringify(user));
      }} />;
    }
    return (
      <div className="min-h-screen bg-[#2b2b2b] flex items-center justify-center text-[#00ff88] font-bold">
        Соединение...
      </div>
    );
  }

  return <MessengerApp currentUser={currentUser} socket={socket} isWindowFocused={isWindowFocused} onLogout={() => {
    localStorage.removeItem('nemessenger_user');
    setIsAuth(false);
    setCurrentUser(null);
    socket?.disconnect();
  }} />;
}

// --- Auth Screen ---
function AuthScreen({ onAuth }: { onAuth: (user: UserData) => void }) {
  const [mode, setMode] = useState<'login' | 'register' | '2fa' | 'recover' | 'verify_phone'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [avatar, setAvatar] = useState('');
  const [code, setCode] = useState('');
  const [pendingUserId, setPendingUserId] = useState<number | null>(null);
  const [regType, setRegType] = useState<'email' | 'phone'>('email');
  const [otpSent, setOtpSent] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setAvatar(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSendOTP = async () => {
    const identifier = regType === 'email' ? email : phone;
    if (!identifier) return alert('Введите ' + (regType === 'email' ? 'Email' : 'номер телефона'));
    
    setIsSendingOtp(true);
    try {
      const res = await fetch('/api/send_otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });
      const data = await res.json();
      if (data.success) {
        setOtpSent(true);
        if (data.devCode) {
          alert(`ДЕМО-РЕЖИМ: Ваш код подтверждения: ${data.devCode}${data.devUrl ? `\n\nПисьмо можно посмотреть здесь: ${data.devUrl}` : ''}`);
        } else {
          alert('Код отправлен!');
        }
      } else {
        alert(data.message);
      }
    } catch (err) {
      alert('Ошибка при отправке кода');
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (mode === 'login') {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: email, password }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.requires2FA) {
          setPendingUserId(data.userId);
          setMode('2fa');
        } else {
          onAuth(data.user);
        }
      } else {
        alert(data.message);
      }
    } else if (mode === 'register') {
      if (!otpSent) return alert('Сначала отправьте код подтверждения');
      
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email: regType === 'email' ? email : null, 
          phone: regType === 'phone' ? phone : null,
          password, 
          nickname, 
          username, 
          avatar,
          code 
        }),
      });
      const data = await res.json();
      if (data.success) {
        onAuth(data.user);
      } else {
        alert(data.message);
      }
    } else if (mode === '2fa') {
      const res = await fetch('/api/verify_2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: pendingUserId, code }),
      });
      const data = await res.json();
      if (data.success) {
        onAuth(data.user);
      } else {
        alert(data.message);
      }
    } else if (mode === 'verify_phone') {
      const res = await fetch('/api/verify_phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: pendingUserId, code }),
      });
      const data = await res.json();
      if (data.success) {
        // After phone verification, log them in
        const resLogin = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const dataLogin = await resLogin.json();
        onAuth(dataLogin.user);
      } else {
        alert(data.message);
      }
    } else if (mode === 'recover') {
      const res = await fetch('/api/recover_password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      alert(data.message);
      if (data.success) setMode('login');
    }
  };

  return (
    <div className="min-h-screen bg-[#2b2b2b] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-[#3b3b3b] p-8 rounded-2xl shadow-2xl w-full max-w-md"
      >
        <h2 className="text-3xl font-bold text-[#00ff88] text-center mb-8">
          {mode === 'login' && 'Вход'}
          {mode === 'register' && 'Регистрация'}
          {mode === '2fa' && 'Двухфакторная аутентификация'}
          {mode === 'recover' && 'Восстановление пароля'}
          {mode === 'verify_phone' && 'Подтверждение номера'}
        </h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div className="flex flex-col items-center mb-4">
              <div className="w-24 h-24 rounded-full bg-[#555] overflow-hidden mb-2 border-2 border-[#00ff88]">
                {avatar ? (
                  <img src={avatar} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400">
                    <User size={48} />
                  </div>
                )}
              </div>
              <label className="text-[#00ff88] text-sm cursor-pointer hover:underline">
                Выбрать аватар
                <input type="file" className="hidden" accept="image/*" onChange={handleAvatarChange} />
              </label>
            </div>
          )}

          {(mode === 'login' || mode === 'recover') && (
            <input
              type="text"
              placeholder={mode === 'recover' ? 'Email' : 'Email или Телефон'}
              className="w-full p-3 rounded-lg bg-[#4b4b4b] text-white border border-transparent focus:border-[#00ff88] outline-none transition-all"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          )}

          {mode === 'register' && (
            <div className="space-y-4">
              <div className="flex bg-[#4b4b4b] rounded-lg p-1">
                <button 
                  type="button"
                  onClick={() => setRegType('email')}
                  className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${regType === 'email' ? 'bg-[#00ff88] text-black' : 'text-gray-400'}`}
                >
                  Email
                </button>
                <button 
                  type="button"
                  onClick={() => setRegType('phone')}
                  className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${regType === 'phone' ? 'bg-[#00ff88] text-black' : 'text-gray-400'}`}
                >
                  Телефон
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  type={regType === 'email' ? 'email' : 'tel'}
                  placeholder={regType === 'email' ? 'Email' : 'Номер телефона'}
                  className="flex-1 p-3 rounded-lg bg-[#4b4b4b] text-white border border-transparent focus:border-[#00ff88] outline-none transition-all"
                  value={regType === 'email' ? email : phone}
                  onChange={(e) => regType === 'email' ? setEmail(e.target.value) : setPhone(e.target.value)}
                  required
                />
                <button 
                  type="button"
                  onClick={handleSendOTP}
                  disabled={isSendingOtp}
                  className="px-4 bg-[#00ff88] text-black font-bold rounded-lg text-xs hover:bg-[#00cc6e] transition-all disabled:opacity-50"
                >
                  {isSendingOtp ? '...' : otpSent ? 'Еще раз' : 'Код'}
                </button>
              </div>

              {otpSent && (
                <input
                  type="text"
                  placeholder="Код подтверждения"
                  className="w-full p-3 rounded-lg bg-[#4b4b4b] text-white border border-transparent focus:border-[#00ff88] outline-none transition-all text-center tracking-widest font-bold"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              )}
            </div>
          )}

          {(mode === 'login' || mode === 'register') && (
            <input
              type="password"
              placeholder="Пароль"
              className="w-full p-3 rounded-lg bg-[#4b4b4b] text-white border border-transparent focus:border-[#00ff88] outline-none transition-all"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          )}

          {mode === 'register' && (
            <>
              <input
                type="text"
                placeholder="Имя (Никнейм)"
                className="w-full p-3 rounded-lg bg-[#4b4b4b] text-white border border-transparent focus:border-[#00ff88] outline-none transition-all"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                required
              />
              <input
                type="text"
                placeholder="Username (@username)"
                className="w-full p-3 rounded-lg bg-[#4b4b4b] text-white border border-transparent focus:border-[#00ff88] outline-none transition-all"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </>
          )}

          {mode === '2fa' && (
            <div className="space-y-2">
              <p className="text-gray-400 text-sm text-center">
                Введите код из приложения (123456)
              </p>
              <input
                type="text"
                placeholder="Код подтверждения"
                className="w-full p-3 rounded-lg bg-[#4b4b4b] text-white border border-transparent focus:border-[#00ff88] outline-none transition-all text-center text-2xl tracking-widest"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </div>
          )}

          <button
            type="submit"
            className="w-full py-3 bg-[#00b35e] hover:bg-[#009950] text-white font-bold rounded-lg transition-colors shadow-lg"
          >
            {mode === 'login' && 'Войти'}
            {mode === 'register' && 'Зарегистрироваться'}
            {mode === '2fa' && 'Подтвердить'}
            {mode === 'recover' && 'Отправить инструкции'}
          </button>
        </form>

        <div className="mt-6 flex flex-col gap-2">
          {mode === 'login' && (
            <>
              <button onClick={() => setMode('register')} className="text-[#00ff88] text-sm hover:underline">Нет аккаунта? Регистрация</button>
              <button onClick={() => setMode('recover')} className="text-gray-400 text-sm hover:underline">Забыли пароль?</button>
            </>
          )}
          {(mode === 'register' || mode === 'recover' || mode === '2fa') && (
            <button onClick={() => setMode('login')} className="text-[#00ff88] text-sm hover:underline">Вернуться к входу</button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// --- Stories Bar ---
function StoriesBar({ stories, onStoryClick, onAddStory }: { stories: any[], onStoryClick: (index: number) => void, onAddStory: () => void }) {
  return (
    <div className="flex gap-4 p-4 overflow-x-auto bg-white border-b border-gray-100 scrollbar-hide">
      <button 
        onClick={onAddStory}
        className="flex flex-col items-center gap-1 min-w-[64px]"
      >
        <div className="w-14 h-14 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:border-[#00b35e] hover:text-[#00b35e] transition-all">
          <Plus size={24} />
        </div>
        <span className="text-[10px] font-bold text-gray-500 uppercase">Моя</span>
      </button>
      {stories.map((story, idx) => (
        <button 
          key={story.id} 
          onClick={() => onStoryClick(idx)}
          className="flex flex-col items-center gap-1 min-w-[64px]"
        >
          <div className="w-14 h-14 rounded-full border-2 border-[#00ff88] p-0.5">
            <img src={story.avatar} className="w-full h-full rounded-full object-cover" alt="" />
          </div>
          <span className="text-[10px] font-bold text-gray-500 uppercase truncate w-14">{story.nickname}</span>
        </button>
      ))}
    </div>
  );
}

// --- Stories Modal ---
function StoriesModal({ stories, activeIndex, onClose }: { stories: any[], activeIndex: number, onClose: () => void }) {
  const [currentIdx, setCurrentIdx] = useState(activeIndex);
  const story = stories[currentIdx];

  useEffect(() => {
    const timer = setTimeout(() => {
      if (currentIdx < stories.length - 1) {
        setCurrentIdx(currentIdx + 1);
      } else {
        onClose();
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [currentIdx]);

  if (!story) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center">
      <div className="absolute top-4 left-4 right-4 flex gap-1 z-10">
        {stories.map((_, i) => (
          <div key={i} className="flex-1 h-1 bg-white/20 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: i === currentIdx ? '100%' : i < currentIdx ? '100%' : '0%' }}
              transition={{ duration: i === currentIdx ? 5 : 0, ease: "linear" }}
              className="h-full bg-white"
            />
          </div>
        ))}
      </div>
      <button onClick={onClose} className="absolute top-8 right-4 text-white z-20"><X size={32} /></button>
      
      <div className="absolute top-10 left-4 flex items-center gap-3 z-10">
        <img src={story.avatar} className="w-10 h-10 rounded-full border-2 border-white" alt="" />
        <div>
          <p className="text-white font-bold text-sm">{story.nickname}</p>
          <p className="text-white/60 text-xs">{new Date(story.created_at).toLocaleTimeString()}</p>
        </div>
      </div>

      <img src={story.media_url} className="max-w-full max-h-full object-contain" alt="" />
      
      {story.caption && (
        <div className="absolute bottom-10 left-0 right-0 p-8 text-center bg-gradient-to-t from-black/80 to-transparent">
          <p className="text-white text-lg">{story.caption}</p>
        </div>
      )}

      <div className="absolute inset-y-0 left-0 w-1/3" onClick={() => setCurrentIdx(Math.max(0, currentIdx - 1))} />
      <div className="absolute inset-y-0 right-0 w-1/3" onClick={() => setCurrentIdx(Math.min(stories.length - 1, currentIdx + 1))} />
    </div>
  );
}

// --- Mini Apps Modal ---
function MiniAppsModal({ apps, onClose }: { apps: any[], onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-2xl relative max-h-[80vh] flex flex-col"
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-red-500"><X size={24} /></button>
        <h3 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
          <LayoutGrid className="text-[#00b35e]" /> Мини-приложения
        </h3>
        
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 overflow-y-auto p-2">
          {apps.length === 0 ? (
            <div className="col-span-full py-12 text-center text-gray-400">
              <Bot size={48} className="mx-auto mb-2 opacity-20" />
              <p>Пока нет доступных приложений</p>
            </div>
          ) : (
            apps.map(app => (
              <button key={app.id} className="flex flex-col items-center p-4 bg-gray-50 rounded-2xl hover:bg-gray-100 transition-all group">
                <img src={app.icon_url || 'https://picsum.photos/seed/app/100/100'} className="w-16 h-16 rounded-2xl mb-3 shadow-md group-hover:scale-105 transition-transform" alt="" />
                <span className="font-bold text-gray-800 text-sm">{app.name}</span>
                <span className="text-[10px] text-gray-400 uppercase mt-1">{app.category}</span>
              </button>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
}

// --- Poll Creator ---
function PollCreator({ userId, roomId, onCreated }: { userId: number, roomId: number, onCreated: (pollId: number) => void }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [isAnonymous, setIsAnonymous] = useState(true);

  const handleAddOption = () => setOptions([...options, '']);
  const handleOptionChange = (idx: number, val: string) => {
    const newOpts = [...options];
    newOpts[idx] = val;
    setOptions(newOpts);
  };

  const handleSubmit = async () => {
    if (!question || options.filter(o => o.trim()).length < 2) return alert("Заполните вопрос и минимум 2 варианта");
    
    const res = await fetch('/api/polls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: roomId,
        sender_id: userId,
        question,
        options: options.filter(o => o.trim()),
        is_anonymous: isAnonymous
      })
    });
    
    if (res.ok) {
      const data = await res.json();
      onCreated(data.poll_id);
    }
  };

  return (
    <div className="space-y-4">
      <input 
        placeholder="Вопрос" 
        className="w-full p-3 bg-gray-50 rounded-xl outline-none border focus:border-[#00b35e]"
        value={question}
        onChange={e => setQuestion(e.target.value)}
      />
      <div className="space-y-2 max-h-40 overflow-y-auto">
        {options.map((opt, i) => (
          <input 
            key={i}
            placeholder={`Вариант ${i + 1}`}
            className="w-full p-2 bg-gray-50 rounded-lg outline-none border focus:border-[#00b35e] text-sm"
            value={opt}
            onChange={e => handleOptionChange(i, e.target.value)}
          />
        ))}
        <button onClick={handleAddOption} className="text-[#00b35e] text-xs font-bold flex items-center gap-1 hover:underline">
          <PlusCircle size={14} /> Добавить вариант
        </button>
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={isAnonymous} onChange={e => setIsAnonymous(e.target.checked)} className="accent-[#00b35e]" />
        <span className="text-sm text-gray-600">Анонимный опрос</span>
      </label>
      <button onClick={handleSubmit} className="w-full py-3 bg-[#00b35e] text-white font-bold rounded-xl shadow-lg">Создать</button>
    </div>
  );
}

// --- Payment Creator ---
function PaymentCreator({ userId, targetUserId, onSent }: { userId: number, targetUserId: number, onSent: (paymentId: number, amount: number) => void }) {
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');

  const handleSend = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return alert("Введите корректную сумму");
    
    const res = await fetch('/api/payments/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender_id: userId,
        receiver_id: targetUserId,
        amount: amt,
        currency: 'RUB'
      })
    });
    
    if (res.ok) {
      const data = await res.json();
      onSent(data.payment_id || Date.now(), amt);
    } else {
      const err = await res.json();
      alert(err.message || "Ошибка при переводе");
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <input 
          type="number"
          placeholder="0.00" 
          className="w-full p-4 bg-gray-50 rounded-xl outline-none border focus:border-[#00b35e] text-3xl font-bold text-center"
          value={amount}
          onChange={e => setAmount(e.target.value)}
        />
        <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-gray-400">RUB</span>
      </div>
      <input 
        placeholder="Комментарий (необязательно)" 
        className="w-full p-3 bg-gray-50 rounded-xl outline-none border focus:border-[#00b35e] text-sm"
        value={comment}
        onChange={e => setComment(e.target.value)}
      />
      <button 
        onClick={handleSend}
        className="w-full py-4 bg-[#00b35e] text-white font-bold rounded-xl shadow-lg flex items-center justify-center gap-2"
      >
        <CreditCard size={20} /> Отправить
      </button>
    </div>
  );
}

// --- Messenger App ---
function MessengerApp({ currentUser, socket, isWindowFocused, onLogout }: { currentUser: UserData, socket: Socket | null, isWindowFocused: boolean, onLogout: () => void }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [searchResults, setSearchResults] = useState<Room[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [inputText, setInputText] = useState('');
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);
  const [activeMessageMenu, setActiveMessageMenu] = useState<number | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<number[]>([]);
  const [typingUsers, setTypingUsers] = useState<Record<number, string>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showRoomInfoModal, setShowRoomInfoModal] = useState(false);
  const [roomMembers, setRoomMembers] = useState<any[]>([]);
  const [viewProfileId, setViewProfileId] = useState<number | null>(null);
  const [profileData, setProfileData] = useState<UserData | null>(null);
  const [myProfile, setMyProfile] = useState<UserData>(currentUser);
  
  const [stories, setStories] = useState<any[]>([]);
  const [showStoriesModal, setShowStoriesModal] = useState(false);
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);
  const [showMiniAppsModal, setShowMiniAppsModal] = useState(false);
  const [miniApps, setMiniApps] = useState<any[]>([]);
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [showPaymentCreator, setShowPaymentCreator] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  
  const notificationSound = useMemo(() => new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3'), []);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchRooms = async () => {
    const res = await fetch(`/api/my_chats?userId=${myProfile.id}`);
    const data = await res.json();
    setRooms(data);
  };

  const fetchOnlineUsers = async () => {
    const res = await fetch('/api/online_users');
    const data = await res.json();
    setOnlineUsers(data);
  };

  const fetchStories = async () => {
    try {
      const res = await fetch('/api/stories');
      const data = await res.json();
      setStories(data);
    } catch (e) {}
  };

  const fetchMiniApps = async () => {
    try {
      const res = await fetch('/api/mini_apps');
      const data = await res.json();
      setMiniApps(data);
    } catch (e) {}
  };

  useEffect(() => {
    if (viewProfileId) {
      fetch(`/api/user_profile/${viewProfileId}`)
        .then(res => res.json())
        .then(data => setProfileData(data));
    } else {
      setProfileData(null);
    }
  }, [viewProfileId]);

  useEffect(() => {
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (!socket) return;
    fetchRooms();
    fetchOnlineUsers();
    fetchStories();
    fetchMiniApps();

    const storyInterval = setInterval(fetchStories, 60000);

    socket.on('user_status', (data: { userId: number, status: 'online' | 'offline', last_seen?: string }) => {
      setOnlineUsers(prev => {
        if (data.status === 'online') {
          return Array.from(new Set([...prev, data.userId]));
        } else {
          return prev.filter(id => id !== data.userId);
        }
      });
      if (viewProfileId === data.userId && data.last_seen) {
        setProfileData(prev => prev ? { ...prev, last_seen: data.last_seen! } : null);
      }
    });

    socket.on('typing', (data: { room_id: number, nickname: string }) => {
      setTypingUsers(prev => ({ ...prev, [data.room_id]: data.nickname }));
    });

    socket.on('stop_typing', (data: { room_id: number }) => {
      setTypingUsers(prev => {
        const next = { ...prev };
        delete next[data.room_id];
        return next;
      });
    });

    socket.on('room_message', async (msg: Message) => {
      let decryptedText = msg.text;
      if (msg.text.startsWith('[E2EE]')) {
        const privKey = localStorage.getItem(`nemessenger_priv_${currentUser.id}`);
        if (privKey) {
          decryptedText = await decryptMessage(msg.text.replace('[E2EE]', ''), privKey);
        }
      }
      
      const processedMsg = { ...msg, text: decryptedText };

      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, processedMsg];
      });

      // Handle Notification
      const room = rooms.find(r => (r.room_id || r.id) === msg.room_id);
      const isCurrentRoom = currentRoom && (currentRoom.room_id || currentRoom.id) === msg.room_id;
      const isMine = msg.sender_id === currentUser.id;

      if (!isCurrentRoom && !isMine) {
        const globalSettings = safeJsonParse(myProfile.notification_settings, {});
        const roomMuted = room?.is_muted;
        
        if (!globalSettings.global_mute && !roomMuted) {
          if (globalSettings.sound) {
            notificationSound.play().catch(() => {});
          }

          if (Notification.permission === 'granted') {
            new Notification(room?.name || 'Новое сообщение', {
              body: `${msg.nickname}: ${decryptedText}`,
              icon: room?.avatar || msg.avatar
            });
          }
        }
      }
    });

    socket.on('message_deleted', (data: { msg_id: number }) => {
      setMessages(prev => prev.filter(m => m.id !== data.msg_id));
    });

    socket.on('message_edited', (data: { msg_id: number, new_text: string }) => {
      setMessages(prev => prev.map(m => m.id === data.msg_id ? { ...m, text: data.new_text, is_edited: true } : m));
    });

    socket.on('room_deleted', (data: { room_id: number }) => {
      setCurrentRoom(prev => {
        if (prev && (prev.room_id === data.room_id || prev.id === data.room_id)) {
          return null;
        }
        return prev;
      });
      fetchRooms();
    });

    socket.on('message_reacted', (data: { msg_id: number, reactions: any }) => {
      setMessages(prev => prev.map(m => m.id === data.msg_id ? { ...m, reactions: JSON.stringify(data.reactions) } : m));
    });

    return () => {
      socket.off('user_status');
      socket.off('typing');
      socket.off('stop_typing');
      socket.off('room_message');
      socket.off('message_deleted');
      socket.off('message_edited');
      socket.off('message_reacted');
      socket.off('room_deleted');
      clearInterval(storyInterval);
    };
  }, [socket, currentUser.id]);

  useEffect(() => {
    if (searchQuery.trim()) {
      const delayDebounceFn = setTimeout(async () => {
        const res = await fetch(`/api/search?q=${searchQuery}&userId=${currentUser.id}`);
        const data = await res.json();
        setSearchResults(data.filter((i: any) => !(i.type === 'user' && i.id === currentUser.id)));
      }, 300);
      return () => clearTimeout(delayDebounceFn);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery, currentUser.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const openRoom = async (room: any, isSearch = false) => {
    let targetRoom = room;
    let jumpToMsgId = null;

    if (isSearch) {
      if (room.type === 'message') {
        const roomToOpen = rooms.find(r => (r.room_id || r.id) === room.room_id);
        if (roomToOpen) {
          targetRoom = roomToOpen;
          jumpToMsgId = room.id;
        } else {
          const res = await fetch(`/api/room_info?roomId=${room.room_id}`);
          targetRoom = await res.json();
          jumpToMsgId = room.id;
        }
      } else if (room.type === 'user') {
        const res = await fetch('/api/private_chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user1_id: currentUser.id, user2_id: room.id }),
        });
        const data = await res.json();
        targetRoom = { 
          id: data.room_id, 
          room_id: data.room_id,
          type: 'private', 
          name: room.name, 
          avatar: room.avatar, 
          target_user_id: room.id 
        };
      } else {
        await fetch('/api/join_room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: currentUser.id, room_id: room.id }),
        });
      }
      setSearchQuery('');
      socket?.emit('join_socket_room', targetRoom.room_id || targetRoom.id);
      fetchRooms();
    }

    const roomId = targetRoom.room_id || targetRoom.id;
    
    // Fetch full room info including role
    const roomInfoRes = await fetch(`/api/room_info?roomId=${roomId}&userId=${currentUser.id}`);
    if (roomInfoRes.ok) {
      const fullRoomInfo = await roomInfoRes.json();
      setCurrentRoom(fullRoomInfo);
    } else {
      setCurrentRoom(targetRoom);
    }
    
    setIsSidebarOpen(false);

    setEditingMessage(null);
    setInputText('');
    setHasMoreMessages(true);
    
    const res = await fetch(`/api/room_history?roomId=${roomId}&limit=50&offset=0`);
    const history = await res.json();
    const decryptedHistory = await Promise.all(history.map(async (msg: Message) => {
      if (msg.text.startsWith('[E2EE]')) {
        const privKey = localStorage.getItem(`nemessenger_priv_${currentUser.id}`);
        if (privKey) {
          return { ...msg, text: await decryptMessage(msg.text.replace('[E2EE]', ''), privKey) };
        }
      }
      return msg;
    }));
    setMessages(decryptedHistory);
    if (history.length < 50) setHasMoreMessages(false);

    if (targetRoom.type !== 'private') {
      const membersRes = await fetch(`/api/room_members?roomId=${roomId}`);
      const members = await membersRes.json();
      setRoomMembers(members);
    }

    if (jumpToMsgId) {
      setTimeout(() => {
        const el = document.getElementById(`msg-${jumpToMsgId}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el?.classList.add('bg-yellow-100');
        setTimeout(() => el?.classList.remove('bg-yellow-100'), 2000);
      }, 500);
    }
  };

  const loadMoreMessages = async () => {
    if (!currentRoom || loadingHistory || !hasMoreMessages) return;
    setLoadingHistory(true);
    const roomId = currentRoom.room_id || currentRoom.id;
    const offset = messages.length;
    
    try {
      const res = await fetch(`/api/room_history?roomId=${roomId}&limit=50&offset=${offset}`);
      const history = await res.json();
      const decryptedHistory = await Promise.all(history.map(async (msg: Message) => {
        if (msg.text.startsWith('[E2EE]')) {
          const privKey = localStorage.getItem(`nemessenger_priv_${currentUser.id}`);
          if (privKey) {
            return { ...msg, text: await decryptMessage(msg.text.replace('[E2EE]', ''), privKey) };
          }
        }
        return msg;
      }));
      if (history.length < 50) setHasMoreMessages(false);
      setMessages(prev => [...decryptedHistory, ...prev]);
    } catch (e) {
      console.error("Failed to load more messages", e);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !currentRoom) return;

    const roomId = currentRoom.room_id || currentRoom.id;
    let textToSend = inputText;

    // E2EE for private chats
    if (currentRoom.type === 'private') {
      const res = await fetch(`/api/user_profile/${currentRoom.target_user_id}`);
      const profile = await res.json();
      if (profile.public_key) {
        textToSend = await encryptMessage(inputText, profile.public_key);
        textToSend = `[E2EE]${textToSend}`;
      }
    }

    if (editingMessage) {
      socket.emit('edit_message', {
        room_id: roomId,
        sender_id: currentUser.id,
        msg_id: editingMessage.id,
        new_text: inputText,
      });
      setEditingMessage(null);
    } else {
      socket.emit('room_message', {
        room_id: roomId,
        sender_id: currentUser.id,
        text: inputText,
        reply_to_id: replyingTo?.id,
      });
      socket.emit('stop_typing', { room_id: roomId });
      setReplyingTo(null);
    }
    setInputText('');
  };

  const handleForwardMessage = (room: Room) => {
    if (!forwardingMessage) return;
    const roomId = room.room_id || room.id;
    socket.emit('room_message', {
      room_id: roomId,
      sender_id: currentUser.id,
      text: forwardingMessage.text,
      forward_from_id: forwardingMessage.sender_id,
    });
    setForwardingMessage(null);
    openRoom(room);
  };

  const handleReact = (msgId: number, emoji: string) => {
    const roomId = currentRoom?.room_id || currentRoom?.id;
    socket.emit('react_message', {
      room_id: roomId,
      user_id: currentUser.id,
      msg_id: msgId,
      emoji,
    });
    setActiveMessageMenu(null);
  };

  const handlePinMessage = async (msgId: number) => {
    if (!currentRoom) return;
    const roomId = currentRoom.room_id || currentRoom.id;
    await fetch('/api/pin_message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: roomId, message_id: msgId }),
    });
    fetchRooms(); // Refresh room info to get pinned_message_id
  };

  const handleJoinByInvite = async (inviteCode: string) => {
    const res = await fetch('/api/join_by_invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: currentUser.id, invite_code: inviteCode }),
    });
    const data = await res.json();
    if (data.success) {
      fetchRooms();
      setSearchQuery('');
      alert("Вы успешно вступили в группу!");
    } else {
      alert(data.message || "Неверный код приглашения");
    }
  };

  const handleManageMember = async (userId: number, role: string) => {
    if (!currentRoom) return;
    const roomId = currentRoom.room_id || currentRoom.id;
    await fetch('/api/manage_member', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: roomId, user_id: userId, role }),
    });
    const membersRes = await fetch(`/api/room_members?roomId=${roomId}`);
    const members = await membersRes.json();
    setRoomMembers(members);
  };

  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const handleDeleteRoom = async () => {
    if (!currentRoom) return;
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      setTimeout(() => setDeleteConfirm(false), 3000);
      return;
    }

    const roomId = currentRoom.room_id || currentRoom.id;
    console.log('Executing delete for room ID:', roomId);
    setIsDeleting(true);
    
    try {
      const res = await fetch('/api/delete_room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_id: Number(roomId), user_id: currentUser.id }),
      });
      
      const result = await res.json();
      if (res.ok && result.success) {
        console.log('Room deleted successfully');
        setShowRoomInfoModal(false);
        setDeleteConfirm(false);
        setCurrentRoom(null);
        fetchRooms();
      } else {
        console.error('Failed to delete room:', result);
        alert(`Ошибка: ${result.message || 'Нет доступа'}`);
        setDeleteConfirm(false);
      }
    } catch (error) {
      console.error('Error during delete room fetch:', error);
      alert('Сетевая ошибка при удалении');
      setDeleteConfirm(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleLeaveRoom = async () => {
    if (!currentRoom) return;
    if (!confirm('Вы уверены, что хотите выйти из этого чата?')) return;
    
    const roomId = currentRoom.room_id || currentRoom.id;
    const res = await fetch('/api/leave_room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: roomId, user_id: currentUser.id }),
    });
    
    if (res.ok) {
      setShowRoomInfoModal(false);
      setCurrentRoom(null);
      fetchRooms();
    } else {
      alert('Ошибка при выходе из чата');
    }
  };

  const handleUpdateRoomSettings = async (isMuted: boolean, priority: string) => {
    if (!currentRoom) return;
    const roomId = currentRoom.room_id || currentRoom.id;
    await fetch('/api/update_room_settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: roomId, user_id: currentUser.id, is_muted: isMuted, notification_priority: priority }),
    });
    fetchRooms();
    setCurrentRoom(prev => prev ? { ...prev, is_muted: isMuted, notification_priority: priority as any } : null);
  };

  const handleUpdateGlobalSettings = async (settings: any) => {
    await fetch('/api/update_global_settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: currentUser.id, notification_settings: settings }),
    });
    const updatedUser = { ...myProfile, notification_settings: JSON.stringify(settings) };
    setMyProfile(updatedUser);
    localStorage.setItem('nemessenger_user', JSON.stringify(updatedUser));
  };

  const [isRecipientBlocked, setIsRecipientBlocked] = useState(false);

  useEffect(() => {
    if (viewProfileId && currentUser) {
      fetch(`/api/is_blocked?blocker_id=${currentUser.id}&blocked_id=${viewProfileId}`)
        .then(res => res.json())
        .then(data => setIsRecipientBlocked(data.blocked));
    }
  }, [viewProfileId, currentUser]);

  const handleBlockUser = async () => {
    if (!viewProfileId || !currentUser) return;
    await fetch('/api/block_user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocker_id: currentUser.id, blocked_id: viewProfileId }),
    });
    setIsRecipientBlocked(true);
  };

  const handleUnblockUser = async () => {
    if (!viewProfileId || !currentUser) return;
    await fetch('/api/unblock_user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocker_id: currentUser.id, blocked_id: viewProfileId }),
    });
    setIsRecipientBlocked(false);
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    if (!currentRoom || currentRoom.type === 'channel') return;

    const roomId = currentRoom.room_id || currentRoom.id;
    socket.emit('typing', { room_id: roomId, nickname: currentUser.nickname });

    // Debounce stop typing
    const timeoutId = (window as any).typingTimeout;
    if (timeoutId) clearTimeout(timeoutId);
    (window as any).typingTimeout = setTimeout(() => {
      socket.emit('stop_typing', { room_id: roomId });
    }, 2000);
  };

  const handleDeleteMessage = (msgId: number) => {
    if (window.confirm("Удалить сообщение для всех?")) {
      const roomId = currentRoom?.room_id || currentRoom?.id;
      socket.emit('delete_message', {
        room_id: roomId,
        sender_id: currentUser.id,
        msg_id: msgId,
      });
    }
  };

  const handleStartEdit = (msg: Message) => {
    setEditingMessage(msg);
    setInputText(msg.text);
  };

  const isUserOnline = (userId?: number) => userId ? onlineUsers.includes(userId) : false;

  const parseMarkdown = (text: string) => {
    let html = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/`(.*?)`/g, '<code class="bg-black/10 px-1 rounded">$1</code>');
    return <span dangerouslySetInnerHTML={{ __html: html }} />;
  };

  return (
    <div className={`flex h-screen w-screen bg-[#f0f2f5] overflow-hidden font-sans transition-all duration-500 ${!isWindowFocused ? 'blur-xl grayscale' : ''}`}>
      {/* Sidebar */}
      <div className={`${isSidebarOpen ? 'flex' : 'hidden'} md:flex w-full md:w-80 bg-white border-r border-gray-200 flex-col shadow-lg z-20`}>
        <div className="p-4 bg-[#2b2b2b] text-white flex justify-between items-center">
          <div className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setShowSettingsModal(true)}>
            <img src={myProfile.avatar} className="w-10 h-10 rounded-full object-cover border border-white/20" alt="Me" />
            <div className="flex flex-col">
              <span className="font-bold truncate max-w-[120px]">{myProfile.nickname}</span>
              <span className="text-[10px] text-gray-400">@{myProfile.username}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button 
              onClick={() => setIsBroadcasting(!isBroadcasting)}
              className={`p-2 rounded-full transition-all ${isBroadcasting ? 'bg-red-500 text-white shadow-lg animate-pulse' : 'hover:bg-white/10 text-white/80 hover:text-white'}`}
              title={isBroadcasting ? "Остановить трансляцию" : "Начать трансляцию"}
            >
              <Radio size={20} />
            </button>
            <button 
              onClick={() => setShowMiniAppsModal(true)}
              className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/80 hover:text-white"
              title="Мини-приложения"
            >
              <LayoutGrid size={20} />
            </button>
            <button onClick={() => setShowSettingsModal(true)} className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/80 hover:text-white">
              <Settings size={20} />
            </button>
            <button onClick={onLogout} className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/80 hover:text-white">
              <LogOut size={20} />
            </button>
          </div>
        </div>

        <div className="p-3 bg-gray-50 border-bottom border-gray-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Поиск..."
              className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-full outline-none focus:ring-2 focus:ring-[#00b35e]/20 focus:border-[#00b35e] transition-all text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {!searchQuery && (
          <StoriesBar 
            stories={stories} 
            onStoryClick={(idx) => { setActiveStoryIndex(idx); setShowStoriesModal(true); }} 
            onAddStory={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/*,video/*';
              input.onchange = async (e: any) => {
                const file = e.target.files[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = async (ev) => {
                    const res = await fetch('/api/stories', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        user_id: myProfile.id,
                        media_url: ev.target?.result,
                        media_type: file.type.startsWith('video') ? 'video' : 'image',
                        caption: ''
                      })
                    });
                    if (res.ok) fetchStories();
                  };
                  reader.readAsDataURL(file);
                }
              };
              input.click();
            }}
          />
        )}

        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-2 flex justify-between items-center">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
              {searchQuery ? 'Результаты поиска' : 'Чаты и Каналы'}
            </span>
            {!searchQuery && (
              <button onClick={() => setShowCreateModal(true)} className="text-[#00b35e] hover:bg-[#00b35e]/10 p-1 rounded-full transition-colors">
                <Plus size={20} />
              </button>
            )}
          </div>

          <div className="space-y-0.5">
            {(searchQuery ? searchResults : rooms).map((room) => {
              const roomId = room.room_id || room.id;
              const isActive = currentRoom && (currentRoom.room_id || currentRoom.id) === roomId;
              const online = room.type === 'private' || room.type === 'user' ? isUserOnline(room.target_user_id || room.id) : false;

              return (
                <div key={roomId} className="relative group">
                  <button
                    onClick={() => openRoom(room, !!searchQuery)}
                    className={`w-full p-3 flex items-center gap-3 transition-all border-l-4 ${
                      isActive ? 'bg-[#e0f2f1] border-[#00b35e]' : 'hover:bg-gray-50 border-transparent'
                    }`}
                  >
                    <div className="relative flex-shrink-0">
                      <img 
                        src={room.avatar} 
                        className="w-12 h-12 rounded-full object-cover shadow-sm" 
                        alt={room.name} 
                        loading="lazy"
                      />
                      {online && (
                        <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-[#00ff88] border-2 border-white rounded-full" />
                      )}
                    </div>
                    <div className="flex-1 text-left overflow-hidden">
                      <div className="font-bold text-gray-800 truncate">{room.name}</div>
                      <div className="text-xs text-gray-500 flex items-center gap-1">
                        {room.type === 'private' && <User size={10} />}
                        {room.type === 'group' && <Users size={10} />}
                        {room.type === 'channel' && <Radio size={10} />}
                        {room.type === 'message' && <MessageSquare size={10} />}
                        <span className="capitalize">
                          {room.type === 'private' ? 'Личный чат' : 
                           room.type === 'group' ? 'Группа' : 
                           room.type === 'channel' ? 'Канал' : 
                           room.type === 'message' ? `Сообщение в ${room.room_name}` :
                           'Пользователь'}
                        </span>
                      </div>
                      {room.type === 'message' && (
                        <div className="text-[10px] text-gray-400 truncate mt-0.5 italic">
                          "{room.text}"
                        </div>
                      )}
                    </div>
                  </button>
                </div>
              );
            })}
            {searchQuery && searchQuery.length >= 8 && !searchResults.some(r => r.invite_code === searchQuery) && (
              <button 
                onClick={() => handleJoinByInvite(searchQuery)}
                className="w-full p-4 flex items-center gap-3 bg-[#00b35e]/10 text-[#00b35e] hover:bg-[#00b35e]/20 transition-all border-y border-[#00b35e]/20"
              >
                <Link size={20} />
                <div className="flex flex-col text-left">
                  <span className="font-bold text-sm">Вступить по ссылке</span>
                  <span className="text-[10px] opacity-70">Код: {searchQuery}</span>
                </div>
              </button>
            )}
            {(searchQuery ? searchResults : rooms).length === 0 && (
              <div className="p-8 text-center text-gray-400 text-sm">Пусто</div>
            )}
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div className={`${!isSidebarOpen ? 'flex' : 'hidden'} md:flex flex-1 flex flex-col bg-[#e5ddd5] relative`}>
        {currentRoom ? (
          <>
            <div className="p-4 bg-white border-b border-gray-200 flex items-center gap-4 shadow-sm z-10">
              <button 
                onClick={() => setIsSidebarOpen(true)}
                className="md:hidden p-2 -ml-2 hover:bg-gray-100 rounded-full text-gray-500"
              >
                <ArrowLeft size={20} />
              </button>
              <img 
                src={currentRoom.avatar} 
                className="w-10 h-10 rounded-full object-cover cursor-pointer hover:opacity-80 transition-opacity" 
                alt={currentRoom.name} 
                onClick={() => {
                  if (currentRoom.type !== 'private') {
                    setShowRoomInfoModal(true);
                  } else {
                    setViewProfileId(currentRoom.target_user_id || currentRoom.id);
                  }
                }}
              />
              <div 
                className="flex flex-col cursor-pointer"
                onClick={() => {
                  if (currentRoom.type !== 'private') {
                    setShowRoomInfoModal(true);
                  } else {
                    setViewProfileId(currentRoom.target_user_id || currentRoom.id);
                  }
                }}
              >
                <span className="font-bold text-gray-800">{currentRoom.name}</span>
                <span className={`text-xs ${
                  typingUsers[currentRoom.room_id || currentRoom.id] 
                    ? 'text-blue-500 italic' 
                    : (currentRoom.type === 'private' && isUserOnline(currentRoom.target_user_id)) 
                      ? 'text-[#00b35e] font-bold' 
                      : 'text-gray-400'
                }`}>
                  {typingUsers[currentRoom.room_id || currentRoom.id] 
                    ? `${typingUsers[currentRoom.room_id || currentRoom.id]} печатает...` 
                    : currentRoom.type === 'private' 
                      ? (isUserOnline(currentRoom.target_user_id) ? 'в сети' : 'был(а) недавно')
                      : currentRoom.type === 'group' ? 'Группа' : 'Канал'}
                </span>
              </div>
            </div>

            {currentRoom.pinned_message_id && (
              <div className="bg-white/90 backdrop-blur-sm border-b border-gray-100 p-2 flex items-center gap-3 shadow-sm z-10">
                <Pin size={14} className="text-[#00b35e]" />
                <div className="flex-1 overflow-hidden">
                  <div className="text-[10px] font-bold text-[#00b35e]">Закрепленное сообщение</div>
                  <div className="text-xs text-gray-500 truncate">
                    {messages.find(m => m.id === currentRoom.pinned_message_id)?.text || "Сообщение удалено"}
                  </div>
                </div>
                <button 
                  onClick={() => {
                    const msg = messages.find(m => m.id === currentRoom.pinned_message_id);
                    if (msg) {
                      const el = document.getElementById(`msg-${msg.id}`);
                      el?.scrollIntoView({ behavior: 'smooth' });
                    }
                  }}
                  className="text-xs text-[#00b35e] font-bold hover:underline"
                >
                  Перейти
                </button>
              </div>
            )}

                <div className="flex-1 overflow-y-auto p-4 space-y-4 flex flex-col scrollbar-hide">
                  {hasMoreMessages && (
                    <button 
                      onClick={loadMoreMessages}
                      disabled={loadingHistory}
                      className="self-center text-xs text-[#00b35e] font-bold hover:bg-[#00b35e]/10 px-4 py-2 rounded-full transition-all disabled:opacity-50 mb-4"
                    >
                      {loadingHistory ? 'Загрузка...' : 'Загрузить еще'}
                    </button>
                  )}
                  {messages.map((msg) => {
                    const isMine = msg.sender_id === currentUser.id;
                    const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    const replyTo = msg.reply_to_id ? messages.find(m => m.id === msg.reply_to_id) : null;
                    const reactions = safeJsonParse(msg.reactions, {});

                    return (
                      <div key={msg.id} id={`msg-${msg.id}`} className={`flex items-end gap-2 group ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
                        {!isMine && currentRoom.type !== 'private' && (
                          <img 
                            src={msg.avatar} 
                            className="w-8 h-8 rounded-full object-cover mb-1" 
                            alt={msg.nickname} 
                            loading="lazy"
                          />
                        )}
                        <div className="relative max-w-[70%]">
                          <div className={`p-3 rounded-2xl shadow-sm ${
                            isMine ? 'bg-[#dcf8c6] rounded-br-none' : 'bg-white rounded-bl-none'
                          }`}>
                            {!isMine && currentRoom.type === 'group' && (
                              <div className="text-[10px] font-bold text-[#00b35e] mb-1">{msg.nickname}</div>
                            )}
                            
                            {msg.forward_from_id && (
                              <div className="text-[10px] text-gray-400 italic mb-1 flex items-center gap-1">
                                <Forward size={10} /> Переслано
                              </div>
                            )}

                            {replyTo && (
                              <div className="mb-2 p-2 bg-black/5 rounded-lg border-l-4 border-[#00b35e] text-xs">
                                <div className="font-bold text-[#00b35e]">{replyTo.nickname}</div>
                                <div className="text-gray-500 truncate">{replyTo.text}</div>
                              </div>
                            )}

                            {msg.message_type === 'poll' && msg.poll_id && (
                              <PollMessage pollId={msg.poll_id} userId={currentUser.id} />
                            )}

                            {msg.message_type === 'payment' && msg.payment_id && (
                              <PaymentMessage paymentId={msg.payment_id} isOwn={isMine} />
                            )}

                            {msg.message_type === 'text' && (
                              <div className="text-sm text-gray-800 break-words select-none">
                                {parseMarkdown(msg.text)}
                              </div>
                            )}
                            
                            <div className="flex items-center justify-end gap-1 mt-1">
                              {!!msg.is_edited && <span className="text-[9px] text-gray-400 italic">(изм.)</span>}
                              <span className="text-[9px] text-gray-400">{time}</span>
                            </div>

                            {Object.keys(reactions).length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {Object.entries(reactions).map(([emoji, users]: [string, any]) => (
                                  <button 
                                    key={emoji}
                                    onClick={() => handleReact(msg.id, emoji)}
                                    className={`px-1.5 py-0.5 rounded-full text-[10px] flex items-center gap-1 transition-all ${
                                      users.includes(currentUser.id) ? 'bg-[#00b35e]/20 border-[#00b35e]' : 'bg-gray-100 border-transparent'
                                    } border`}
                                  >
                                    <span>{emoji}</span>
                                    <span className="font-bold">{users.length}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          
                          <div className={`absolute -top-4 ${isMine ? 'right-0' : 'left-0'} hidden group-hover:flex bg-black/60 rounded-full px-2 py-1 gap-2 backdrop-blur-sm z-10`}>
                            <button onClick={() => setReplyingTo(msg)} className="text-white hover:text-[#00ff88] transition-colors" title="Ответить">
                              <Reply size={12} />
                            </button>
                            <button onClick={() => setForwardingMessage(msg)} className="text-white hover:text-[#00ff88] transition-colors" title="Переслать">
                              <Forward size={12} />
                            </button>
                            <button onClick={() => setActiveMessageMenu(msg.id)} className="text-white hover:text-[#00ff88] transition-colors" title="Реакция">
                              <Smile size={12} />
                            </button>
                            {(currentRoom.role === 'owner' || currentRoom.role === 'admin') && (
                              <button onClick={() => handlePinMessage(msg.id)} className="text-white hover:text-[#00ff88] transition-colors" title="Закрепить">
                                <Pin size={12} />
                              </button>
                            )}
                            {isMine && (
                              <>
                                <button onClick={() => handleStartEdit(msg)} className="text-white hover:text-[#00ff88] transition-colors" title="Редактировать">
                                  <Edit2 size={12} />
                                </button>
                                <button onClick={() => handleDeleteMessage(msg.id)} className="text-white hover:text-red-400 transition-colors" title="Удалить">
                                  <Trash2 size={12} />
                                </button>
                              </>
                            )}
                          </div>

                          {activeMessageMenu === msg.id && (
                            <div className="absolute top-full mt-1 left-0 bg-white shadow-xl rounded-xl p-2 flex gap-2 z-20 border border-gray-100">
                              {['👍', '❤️', '😂', '😮', '😢', '🔥'].map(emoji => (
                                <button 
                                  key={emoji} 
                                  onClick={() => handleReact(msg.id, emoji)}
                                  className="hover:scale-125 transition-transform text-lg"
                                >
                                  {emoji}
                                </button>
                              ))}
                              <button onClick={() => setActiveMessageMenu(null)} className="text-gray-400 hover:text-red-500">
                                <X size={16} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

            {currentRoom.type === 'channel' && currentRoom.owner_id !== currentUser.id ? (
              <div className="p-4 bg-gray-100/80 backdrop-blur-sm text-center text-gray-500 font-bold border-t border-gray-200">
                Вы не можете писать в этот канал
              </div>
            ) : (
              <div className="p-3 bg-gray-100 border-t border-gray-200">
                <AnimatePresence>
                  {editingMessage && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="flex justify-between items-center px-4 py-2 bg-white rounded-t-lg border-b border-gray-100 text-xs font-bold text-[#00b35e]"
                    >
                      <div className="flex items-center gap-2">
                        <Edit2 size={12} />
                        Редактирование
                      </div>
                      <button onClick={() => { setEditingMessage(null); setInputText(''); }} className="text-red-500">
                        <X size={14} />
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
                <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <button 
                      type="button"
                      onClick={() => setShowPollCreator(true)}
                      className="p-2 text-gray-400 hover:text-[#00b35e] transition-colors"
                      title="Создать опрос"
                    >
                      <BarChart2 size={20} />
                    </button>
                    <button 
                      type="button"
                      onClick={() => setShowPaymentCreator(true)}
                      className="p-2 text-gray-400 hover:text-emerald-500 transition-colors"
                      title="Отправить деньги"
                    >
                      <Wallet size={20} />
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="Написать сообщение..."
                    className="flex-1 p-3 rounded-full bg-white border-none outline-none shadow-sm focus:ring-2 focus:ring-[#00b35e]/20"
                    value={inputText}
                    onChange={handleTyping}
                  />
                  <button type="submit" className="p-3 bg-[#00b35e] text-white rounded-full hover:bg-[#009950] transition-all shadow-md active:scale-95">
                    {editingMessage ? <Check size={20} /> : <Send size={20} />}
                  </button>
                </form>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8 text-center">
            <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mb-4 shadow-inner">
              <MessageSquare size={48} />
            </div>
            <h3 className="text-xl font-bold text-gray-500 mb-2">Добро пожаловать в NeMessenger</h3>
            <p className="max-w-xs">Выберите чат из списка слева или найдите новых людей через поиск.</p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showPollCreator && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white md:rounded-2xl p-6 w-full h-full md:h-auto md:max-w-sm shadow-2xl relative"
            >
              <button onClick={() => setShowPollCreator(false)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500">
                <X size={24} />
              </button>
              <h3 className="text-xl font-bold text-gray-800 mb-6 text-center">Создать опрос</h3>
              <PollCreator 
                userId={currentUser.id} 
                roomId={currentRoom.room_id || currentRoom.id}
                onCreated={(pollId) => {
                  setShowPollCreator(false);
                  socket.emit('send_message', {
                    room_id: currentRoom.room_id || currentRoom.id,
                    sender_id: currentUser.id,
                    text: '📊 Опрос',
                    message_type: 'poll',
                    poll_id: pollId
                  });
                }}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showPaymentCreator && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white md:rounded-2xl p-6 w-full h-full md:h-auto md:max-w-sm shadow-2xl relative"
            >
              <button onClick={() => setShowPaymentCreator(false)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500">
                <X size={24} />
              </button>
              <h3 className="text-xl font-bold text-gray-800 mb-6 text-center">Отправить деньги</h3>
              <PaymentCreator 
                userId={currentUser.id} 
                targetUserId={currentRoom.target_user_id || 0}
                onSent={(paymentId, amount) => {
                  setShowPaymentCreator(false);
                  socket.emit('send_message', {
                    room_id: currentRoom.room_id || currentRoom.id,
                    sender_id: currentUser.id,
                    text: `💸 Перевод: ${amount} ₸`,
                    message_type: 'payment',
                    payment_id: paymentId
                  });
                  // Update local balance
                  setMyProfile(prev => prev ? {...prev, balance: (prev.balance || 0) - amount} : null);
                }}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white md:rounded-2xl p-6 w-full h-full md:h-auto md:max-w-sm shadow-2xl relative overflow-y-auto"
            >
              <button onClick={() => setShowCreateModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500">
                <X size={24} />
              </button>
              <h3 className="text-xl font-bold text-gray-800 mb-6 text-center">Новая комната</h3>
              
              <CreateRoomForm 
                currentUser={myProfile} 
                onCreated={() => { setShowCreateModal(false); fetchRooms(); }} 
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Forward Message Modal */}
      <AnimatePresence>
        {forwardingMessage && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white md:rounded-2xl p-6 w-full h-full md:h-auto md:max-w-sm shadow-2xl relative flex flex-col max-h-screen md:max-h-[80vh]"
            >
              <button onClick={() => setForwardingMessage(null)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500">
                <X size={24} />
              </button>
              <h3 className="text-xl font-bold text-gray-800 mb-4 text-center">Переслать сообщение</h3>
              <div className="p-3 bg-gray-50 rounded-xl mb-4 text-sm text-gray-600 italic border-l-4 border-[#00b35e]">
                "{forwardingMessage.text}"
              </div>
              <div className="flex-1 overflow-y-auto space-y-2">
                <p className="text-xs font-bold text-gray-400 uppercase mb-2">Выберите чат</p>
                {rooms.map(room => (
                  <button 
                    key={room.room_id || room.id}
                    onClick={() => handleForwardMessage(room)}
                    className="w-full p-3 flex items-center gap-3 hover:bg-gray-50 rounded-xl transition-colors text-left"
                  >
                    <img src={room.avatar} className="w-10 h-10 rounded-full object-cover" alt="" />
                    <span className="font-bold text-gray-700">{room.name}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showSettingsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white md:rounded-2xl p-6 w-full h-full md:h-auto md:max-w-md shadow-2xl relative max-h-screen md:max-h-[90vh] overflow-y-auto"
            >
              <button onClick={() => setShowSettingsModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500">
                <X size={24} />
              </button>
              <h3 className="text-xl font-bold text-gray-800 mb-6 text-center">Настройки профиля</h3>
              
              <SettingsForm 
                user={myProfile} 
                onUpdated={(updatedUser) => { 
                  setMyProfile(updatedUser); 
                  localStorage.setItem('nemessenger_user', JSON.stringify(updatedUser));
                  setShowSettingsModal(false); 
                  fetchRooms(); 
                }} 
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Room Info Modal */}
      <AnimatePresence>
        {showRoomInfoModal && currentRoom && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white md:rounded-2xl p-6 w-full h-full md:h-auto md:max-w-md shadow-2xl relative max-h-screen md:max-h-[90vh] overflow-y-auto"
            >
              <button onClick={() => setShowRoomInfoModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500">
                <X size={24} />
              </button>
              
              <div className="flex flex-col items-center gap-4 mb-6">
                <img src={currentRoom.avatar} className="w-24 h-24 rounded-full object-cover border-4 border-gray-50 shadow-md" alt="" />
                <div className="text-center">
                  <h3 className="text-2xl font-bold text-gray-800">{currentRoom.name}</h3>
                  <p className="text-xs text-gray-400 uppercase tracking-widest mt-1">
                    {currentRoom.type === 'group' ? 'Группа' : 'Канал'}
                  </p>
                </div>
              </div>

              <div className="space-y-6">
                {currentRoom.description && (
                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">Описание</h4>
                    <p className="text-gray-700 text-sm bg-gray-50 p-3 rounded-xl">{currentRoom.description}</p>
                  </div>
                )}

                <div>
                  <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">Ссылка-приглашение</h4>
                  <div className="flex items-center gap-2 bg-gray-50 p-3 rounded-xl border border-dashed border-gray-200">
                    <code className="flex-1 text-sm font-mono text-[#00b35e]">{currentRoom.invite_code}</code>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(currentRoom.invite_code || '');
                        alert("Код скопирован!");
                      }}
                      className="p-2 hover:bg-[#00b35e]/10 rounded-lg text-[#00b35e] transition-colors"
                    >
                      <Link size={16} />
                    </button>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">Уведомления</h4>
                  <div className="space-y-3 bg-gray-50 p-4 rounded-xl">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm text-gray-700">
                        {currentRoom.is_muted ? <BellOff size={16} className="text-red-500" /> : <Bell size={16} className="text-[#00b35e]" />}
                        <span>Без звука</span>
                      </div>
                      <button 
                        onClick={() => handleUpdateRoomSettings(!currentRoom.is_muted, currentRoom.notification_priority || 'all')}
                        className={`w-10 h-5 rounded-full relative transition-colors ${currentRoom.is_muted ? 'bg-red-500' : 'bg-gray-300'}`}
                      >
                        <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${currentRoom.is_muted ? 'right-1' : 'left-1'}`} />
                      </button>
                    </div>
                    
                    <div className="flex flex-col gap-2">
                      <span className="text-[10px] font-bold text-gray-400 uppercase">Приоритет</span>
                      <div className="flex gap-2">
                        {['all', 'mentions', 'none'].map(p => (
                          <button
                            key={p}
                            onClick={() => handleUpdateRoomSettings(!!currentRoom.is_muted, p)}
                            className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                              (currentRoom.notification_priority || 'all') === p 
                                ? 'bg-[#00b35e] text-white shadow-md' 
                                : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-100'
                            }`}
                          >
                            {p === 'all' ? 'Все' : p === 'mentions' ? '@ Упоминания' : 'Никаких'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="text-xs font-bold text-gray-400 uppercase">Участники ({roomMembers.length})</h4>
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                    {roomMembers.map(member => (
                      <div key={member.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-xl transition-colors group">
                        <img src={member.avatar} className="w-8 h-8 rounded-full object-cover" alt="" />
                        <div className="flex-1 flex flex-col">
                          <span className="text-sm font-bold text-gray-700">{member.nickname}</span>
                          <span className="text-[10px] text-gray-400">@{member.username}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {member.role === 'owner' && <ShieldCheck size={14} className="text-amber-500" title="Владелец" />}
                          {member.role === 'admin' && <ShieldCheck size={14} className="text-blue-500" title="Админ" />}
                          
                          {(currentRoom.role === 'owner' || currentRoom.role === 'admin' || currentRoom.owner_id === currentUser.id) && member.id !== currentUser.id && member.role !== 'owner' && (
                            <div className="hidden group-hover:flex items-center gap-1">
                              {member.role === 'member' ? (
                                <button 
                                  onClick={() => handleManageMember(member.id, 'admin')}
                                  className="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded-lg font-bold hover:bg-blue-100"
                                >
                                  Сделать админом
                                </button>
                              ) : (
                                <button 
                                  onClick={() => handleManageMember(member.id, 'member')}
                                  className="text-[10px] bg-gray-100 text-gray-600 px-2 py-1 rounded-lg font-bold hover:bg-gray-200"
                                >
                                  Убрать админа
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {(currentRoom.role === 'owner' || currentRoom.role === 'admin' || currentRoom.owner_id === currentUser.id) ? (
                  <div className="pt-4 border-t border-gray-100">
                    <button 
                      onClick={handleDeleteRoom}
                      disabled={isDeleting}
                      className={`w-full flex items-center justify-center gap-2 p-3 font-bold rounded-xl transition-all ${
                        deleteConfirm 
                          ? 'bg-red-600 text-white animate-pulse' 
                          : 'text-red-500 hover:bg-red-50'
                      } ${isDeleting ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {isDeleting ? (
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Trash2 size={18} />
                      )}
                      {deleteConfirm ? 'НАЖМИТЕ ЕЩЕ РАЗ ДЛЯ УДАЛЕНИЯ' : `Удалить ${currentRoom.type === 'group' ? 'группу' : 'канал'}`}
                    </button>
                    {deleteConfirm && (
                      <p className="text-[10px] text-red-500 text-center mt-1 font-bold">
                        Это действие необратимо!
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="pt-4 border-t border-gray-100">
                    <button 
                      onClick={handleLeaveRoom}
                      className="w-full flex items-center justify-center gap-2 p-3 text-orange-500 font-bold hover:bg-orange-50 rounded-xl transition-colors"
                    >
                      <LogOut size={18} />
                      Выйти из {currentRoom.type === 'group' ? 'группы' : 'канала'}
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* User Profile Modal */}
      <AnimatePresence>
        {viewProfileId && profileData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white md:rounded-2xl p-8 w-full h-full md:h-auto md:max-w-sm shadow-2xl relative text-center overflow-y-auto"
            >
              <button onClick={() => setViewProfileId(null)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500">
                <X size={24} />
              </button>
              
              <div className="flex flex-col items-center gap-4">
                <div className="relative">
                  <img src={profileData.avatar} className="w-32 h-32 rounded-full object-cover border-4 border-[#00b35e]" alt={profileData.nickname} />
                  {isUserOnline(profileData.id) && (
                    <div className="absolute bottom-2 right-2 w-6 h-6 bg-[#00ff88] border-4 border-white rounded-full" />
                  )}
                </div>
                
                <div>
                  <h3 className="text-2xl font-bold text-gray-800">{profileData.nickname}</h3>
                  <p className="text-[#00b35e] font-medium">@{profileData.username}</p>
                </div>

                <div className="w-full h-px bg-gray-100 my-2" />

                <div className="w-full text-left space-y-4">
                  {profileData.bio && (
                    <div>
                      <span className="text-xs font-bold text-gray-400 uppercase">О себе</span>
                      <p className="text-gray-700 text-sm">{profileData.bio}</p>
                    </div>
                  )}
                  
                  <div className="flex items-center gap-3 text-gray-500">
                    <Clock size={16} />
                    <span className="text-sm">
                      {isUserOnline(profileData.id) ? 'В сети' : `Был(а) в сети: ${new Date(profileData.last_seen).toLocaleString()}`}
                    </span>
                  </div>
                </div>

                <button 
                  onClick={() => setViewProfileId(null)}
                  className="w-full mt-4 py-3 bg-[#00b35e] text-white font-bold rounded-xl hover:bg-[#009950] transition-colors"
                >
                  Написать сообщение
                </button>

                {profileData.id !== currentUser.id && (
                  <>
                    <button 
                      onClick={isRecipientBlocked ? handleUnblockUser : handleBlockUser}
                      className={`w-full mt-2 py-2 border rounded-xl font-bold transition-colors flex items-center justify-center gap-2 ${
                        isRecipientBlocked ? 'border-red-500 text-red-500 hover:bg-red-50' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      <Ban size={16} />
                      {isRecipientBlocked ? 'Разблокировать' : 'Заблокировать'}
                    </button>
                    
                    {currentRoom && currentRoom.type === 'private' && (currentRoom.target_user_id === profileData.id || currentRoom.id === profileData.id) && (
                      <button 
                        onClick={handleDeleteRoom}
                        disabled={isDeleting}
                        className={`w-full mt-2 py-2 border rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${
                          deleteConfirm 
                            ? 'bg-red-600 text-white border-red-600 animate-pulse' 
                            : 'border-red-200 text-red-500 hover:bg-red-50'
                        } ${isDeleting ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {isDeleting ? (
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Trash2 size={16} />
                        )}
                        {deleteConfirm ? 'ПОДТВЕРДИТЬ УДАЛЕНИЕ' : 'Удалить чат'}
                      </button>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SettingsForm({ user, onUpdated }: { user: UserData, onUpdated: (user: UserData) => void }) {
  const [activeTab, setActiveTab] = useState<'profile' | 'language' | 'notifications' | 'privacy' | 'security' | 'storage'>('profile');
  const [nickname, setNickname] = useState(user.nickname || '');
  const [username, setUsername] = useState(user.username || '');
  const [bio, setBio] = useState(user.bio || '');
  const [avatar, setAvatar] = useState(user.avatar || '');
  const [privacyLastSeen, setPrivacyLastSeen] = useState(user.privacy_last_seen || 'everyone');
  const [privacyStatus, setPrivacyStatus] = useState(user.privacy_status || 'everyone');
  const [twoFaEnabled, setTwoFaEnabled] = useState(!!user.two_fa_enabled);
  const [notificationSettings, setNotificationSettings] = useState(safeJsonParse(user.notification_settings, {sound:true, global_mute:false}));
  const [language, setLanguage] = useState(user.language || 'ru');
  const [loading, setLoading] = useState(false);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setAvatar(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const clearCache = () => {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('nemessenger_cache_')) localStorage.removeItem(key);
    });
    alert("Кеш успешно очищен!");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/update_profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id: user.id, 
          nickname, 
          username, 
          bio, 
          avatar: avatar || 'https://picsum.photos/seed/user/200/200', 
          privacy_last_seen: privacyLastSeen, 
          privacy_status: privacyStatus,
          two_fa_enabled: twoFaEnabled,
          notification_settings: JSON.stringify(notificationSettings),
          language
        }),
      });
      const data = await res.json();
      if (data.success) {
        onUpdated(data.user);
      } else {
        alert(data.message);
      }
    } catch (err) {
      alert("Ошибка при сохранении профиля");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[500px]">
      <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide mb-4 border-b border-gray-100">
        {[
          { id: 'profile', icon: User, label: 'Профиль' },
          { id: 'language', icon: Languages, label: 'Язык' },
          { id: 'notifications', icon: Bell, label: 'Уведомления' },
          { id: 'privacy', icon: Eye, label: 'Приватность' },
          { id: 'security', icon: Shield, label: 'Безопасность' },
          { id: 'storage', icon: HardDrive, label: 'Память' }
        ].map(tab => (
          <button 
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${
              activeTab === tab.id ? 'bg-[#00b35e] text-white shadow-md' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
            }`}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 flex-1 overflow-y-auto pr-2 scrollbar-hide">
        {activeTab === 'profile' && (
          <div className="space-y-6">
            <div className="flex flex-col items-center">
              <div className="w-24 h-24 rounded-full bg-gray-100 overflow-hidden mb-2 border-2 border-[#00b35e]">
                <img src={avatar} alt="Avatar" className="w-full h-full object-cover" />
              </div>
              <label className="text-[#00b35e] text-xs font-bold cursor-pointer hover:underline">
                Изменить фото
                <input type="file" className="hidden" accept="image/*" onChange={handleAvatarChange} />
              </label>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase px-1">Имя</label>
                <input
                  type="text"
                  className="w-full p-3 rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-[#00b35e] transition-all"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-400 uppercase px-1">Username</label>
                <input
                  type="text"
                  className="w-full p-3 rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-[#00b35e] transition-all"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-400 uppercase px-1">О себе</label>
                <textarea
                  className="w-full p-3 rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-[#00b35e] transition-all resize-none h-24"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Расскажите о себе..."
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'language' && (
          <div className="space-y-4">
            <h4 className="text-sm font-bold text-gray-700">Выберите язык интерфейса</h4>
            <div className="grid grid-cols-1 gap-2">
              {[
                { id: 'ru', label: 'Русский', flag: '🇷🇺' },
                { id: 'en', label: 'English', flag: '🇺🇸' },
                { id: 'kz', label: 'Қазақша', flag: '🇰🇿' }
              ].map(lang => (
                <button 
                  key={lang.id}
                  type="button"
                  onClick={() => setLanguage(lang.id)}
                  className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
                    language === lang.id ? 'border-[#00b35e] bg-[#00b35e]/5' : 'border-gray-100 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{lang.flag}</span>
                    <span className="font-bold text-gray-700">{lang.label}</span>
                  </div>
                  {language === lang.id && <CheckCircle2 className="text-[#00b35e]" size={20} />}
                </button>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'notifications' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
              <div>
                <p className="font-bold text-gray-700">Звук уведомлений</p>
                <p className="text-xs text-gray-400">Воспроизводить звук при новом сообщении</p>
              </div>
              <button 
                type="button"
                onClick={() => setNotificationSettings({...notificationSettings, sound: !notificationSettings.sound})}
                className={`w-10 h-5 rounded-full relative transition-colors ${notificationSettings.sound ? 'bg-[#00b35e]' : 'bg-gray-300'}`}
              >
                <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${notificationSettings.sound ? 'right-1' : 'left-1'}`} />
              </button>
            </div>
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
              <div>
                <p className="font-bold text-gray-700">Беззвучный режим</p>
                <p className="text-xs text-gray-400">Отключить все уведомления</p>
              </div>
              <button 
                type="button"
                onClick={() => setNotificationSettings({...notificationSettings, global_mute: !notificationSettings.global_mute})}
                className={`w-10 h-5 rounded-full relative transition-colors ${notificationSettings.global_mute ? 'bg-red-500' : 'bg-gray-300'}`}
              >
                <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${notificationSettings.global_mute ? 'right-1' : 'left-1'}`} />
              </button>
            </div>
          </div>
        )}

        {activeTab === 'privacy' && (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-gray-400 uppercase px-1">Последний вход</label>
              <select 
                className="w-full p-3 rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-[#00b35e] mt-1"
                value={privacyLastSeen}
                onChange={e => setPrivacyLastSeen(e.target.value)}
              >
                <option value="everyone">Все</option>
                <option value="contacts">Мои контакты</option>
                <option value="nobody">Никто</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-400 uppercase px-1">Статус "В сети"</label>
              <select 
                className="w-full p-3 rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-[#00b35e] mt-1"
                value={privacyStatus}
                onChange={e => setPrivacyStatus(e.target.value)}
              >
                <option value="everyone">Все</option>
                <option value="contacts">Мои контакты</option>
                <option value="nobody">Никто</option>
              </select>
            </div>
            <div className="pt-4">
              <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">Черный список</h4>
              <BlockedUsersList userId={user.id} />
            </div>
          </div>
        )}

        {activeTab === 'security' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
              <div className="flex items-center gap-3">
                <Lock className="text-orange-500" />
                <div>
                  <p className="font-bold text-gray-700">Двухфакторная аутентификация</p>
                  <p className="text-xs text-gray-400">Дополнительный код при входе</p>
                </div>
              </div>
              <input 
                type="checkbox" 
                checked={twoFaEnabled} 
                onChange={e => setTwoFaEnabled(e.target.checked)}
                className="w-5 h-5 accent-[#00b35e]"
              />
            </div>
            <button type="button" className="w-full p-4 bg-gray-50 rounded-xl text-left flex items-center justify-between hover:bg-gray-100 transition-all">
              <div className="flex items-center gap-3">
                <ShieldCheck className="text-[#00b35e]" />
                <span className="font-bold text-gray-700">Активные сессии</span>
              </div>
              <ChevronDown size={16} className="text-gray-400" />
            </button>
          </div>
        )}

        {activeTab === 'storage' && (
          <div className="space-y-4">
            <div className="p-4 bg-gray-50 rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-gray-700">Использование памяти</span>
                <span className="text-xs text-gray-400">12.4 MB</span>
              </div>
              <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="w-[15%] h-full bg-[#00b35e]" />
              </div>
            </div>
            <button 
              type="button" 
              onClick={clearCache}
              className="w-full p-4 bg-red-50 text-red-500 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-red-100 transition-all"
            >
              <Eraser size={20} /> Очистить кеш
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-4 bg-[#00b35e] text-white font-bold rounded-xl shadow-lg hover:bg-[#009950] transition-all disabled:opacity-50"
        >
          {loading ? 'Сохранение...' : 'Сохранить изменения'}
        </button>
      </form>
    </div>
  );
}

function PollMessage({ pollId, userId }: { pollId: number, userId: number }) {
  const [poll, setPoll] = useState<any>(null);
  const [votedOptionId, setVotedOptionId] = useState<number | null>(null);

  const fetchPoll = async () => {
    const res = await fetch(`/api/poll/${pollId}?userId=${userId}`);
    const data = await res.json();
    setPoll(data);
    const userVote = data.options.find((o: any) => o.user_voted);
    if (userVote) setVotedOptionId(userVote.id);
  };

  useEffect(() => {
    fetchPoll();
  }, [pollId]);

  const handleVote = async (optionId: number) => {
    if (votedOptionId) return;
    const res = await fetch('/api/poll/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ poll_id: pollId, user_id: userId, option_id: optionId }),
    });
    const data = await res.json();
    if (data.success) {
      fetchPoll();
    }
  };

  if (!poll) return <div className="text-xs text-gray-400">Загрузка опроса...</div>;

  const totalVotes = poll.options.reduce((acc: number, o: any) => acc + o.votes, 0);

  return (
    <div className="bg-white/10 p-4 rounded-xl space-y-3 min-w-[240px]">
      <h4 className="font-bold text-sm">{poll.question}</h4>
      <div className="space-y-2">
        {poll.options.map((option: any) => {
          const percent = totalVotes > 0 ? Math.round((option.votes / totalVotes) * 100) : 0;
          return (
            <button
              key={option.id}
              onClick={() => handleVote(option.id)}
              className={`w-full text-left relative overflow-hidden rounded-lg p-3 transition-all border ${
                votedOptionId === option.id ? 'border-[#00b35e] bg-[#00b35e]/10' : 'border-white/10 hover:bg-white/5'
              }`}
            >
              <div 
                className="absolute left-0 top-0 bottom-0 bg-[#00b35e]/20 transition-all duration-500" 
                style={{ width: votedOptionId ? `${percent}%` : '0%' }}
              />
              <div className="relative flex justify-between items-center text-xs font-bold">
                <span>{option.text}</span>
                {votedOptionId && <span>{percent}%</span>}
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-gray-400 text-right">{totalVotes} голосов</p>
    </div>
  );
}

function PaymentMessage({ paymentId, isOwn }: { paymentId: number, isOwn: boolean }) {
  const [payment, setPayment] = useState<any>(null);

  useEffect(() => {
    const fetchPayment = async () => {
      const res = await fetch(`/api/payment/${paymentId}`);
      const data = await res.json();
      setPayment(data);
    };
    fetchPayment();
  }, [paymentId]);

  if (!payment) return <div className="text-xs text-gray-400 italic">Перевод...</div>;

  return (
    <div className={`flex items-center gap-3 p-4 rounded-2xl ${isOwn ? 'bg-emerald-600' : 'bg-gray-800'} shadow-lg border border-white/10`}>
      <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
        <Wallet className="text-white" size={20} />
      </div>
      <div>
        <p className="text-[10px] uppercase font-bold opacity-60">Денежный перевод</p>
        <p className="text-lg font-bold">+{payment.amount} ₸</p>
      </div>
    </div>
  );
}

function BlockedUsersList({ userId }: { userId: number }) {
  const [blocked, setBlocked] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBlocked = async () => {
    const res = await fetch(`/api/blocked_users?userId=${userId}`);
    const data = await res.json();
    setBlocked(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchBlocked();
  }, [userId]);

  const handleUnblock = async (blockedId: number) => {
    await fetch('/api/unblock_user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocker_id: userId, blocked_id: blockedId }),
    });
    fetchBlocked();
  };

  if (loading) return <div className="text-xs text-gray-400">Загрузка...</div>;
  if (blocked.length === 0) return <div className="text-xs text-gray-400 italic px-1">Список пуст</div>;

  return (
    <div className="space-y-2 max-h-40 overflow-y-auto pr-2 scrollbar-hide">
      {blocked.map(u => (
        <div key={u.id} className="flex items-center justify-between bg-white p-2 rounded-lg border border-gray-100">
          <div className="flex items-center gap-2">
            <img src={u.avatar} className="w-8 h-8 rounded-full object-cover" alt="" />
            <div className="flex flex-col">
              <span className="text-xs font-bold text-gray-700">{u.nickname}</span>
              <span className="text-[10px] text-gray-400">@{u.username}</span>
            </div>
          </div>
          <button 
            type="button"
            onClick={() => handleUnblock(u.id)}
            className="text-[10px] text-red-500 font-bold hover:underline"
          >
            Разблокировать
          </button>
        </div>
      ))}
    </div>
  );
}

function CreateRoomForm({ currentUser, onCreated }: { currentUser: UserData, onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<'group' | 'channel'>('group');
  const [avatar, setAvatar] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setAvatar(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return alert("Введите название!");
    setLoading(true);
    
    try {
      // Default avatar if none provided
      const finalAvatar = avatar || 'https://picsum.photos/seed/group/200/200';

      const res = await fetch('/api/create_room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type, avatar: finalAvatar, owner_id: currentUser.id, description }),
      });
      const data = await res.json();
      if (data.success) {
        onCreated();
      }
    } catch (err) {
      alert("Ошибка при создании комнаты");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex flex-col items-center">
        <div className="w-20 h-20 rounded-full bg-gray-100 overflow-hidden mb-2 border-2 border-[#00b35e]">
          {avatar ? (
            <img src={avatar} alt="Room" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-300">
              <Users size={32} />
            </div>
          )}
        </div>
        <label className="text-[#00b35e] text-xs font-bold cursor-pointer hover:underline">
          Загрузить картинку
          <input type="file" className="hidden" accept="image/*" onChange={handleAvatarChange} />
        </label>
      </div>

      <input
        type="text"
        placeholder="Название"
        className="w-full p-3 rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-[#00b35e] transition-all"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />

      <textarea
        placeholder="Описание (необязательно)"
        className="w-full p-3 rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-[#00b35e] transition-all resize-none h-20"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <select
        className="w-full p-3 rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-[#00b35e] transition-all"
        value={type}
        onChange={(e) => setType(e.target.value as any)}
      >
        <option value="group">Группа</option>
        <option value="channel">Канал</option>
      </select>

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 bg-[#00b35e] text-white font-bold rounded-lg hover:bg-[#009950] transition-colors shadow-lg disabled:opacity-50"
      >
        {loading ? 'Создание...' : 'Создать'}
      </button>
    </form>
  );
}
