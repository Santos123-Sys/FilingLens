import { Routes, Route } from 'react-router'
import HomeV2 from './pages/HomeV2'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeV2 />} />
    </Routes>
  )
}
