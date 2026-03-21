import streamlit as st
import pandas as pd
from datetime import datetime
import requests
import base64
import folium
from streamlit_folium import st_folium
from streamlit_js_eval import streamlit_js_eval
from geopy.distance import geodesic
from geopy.geocoders import Nominatim

# 1. Configuração Inicial
st.set_page_config(page_title="PetAlerta SCS", page_icon="🐾", layout="centered")

# --- CONFIGURAÇÕES TÉCNICAS ---
SHEET_ID = "1RyredbJZsCPQvBxXqYmX1vBZJRgYToffm5agPxDBDRk"
IMGBB_API_KEY = "54494e69c28056a133620f4e8be0ab72"
ABA_USUARIOS = "Usuarios"
ABA_PETS = "Dados" 
ABA_AVISTAMENTOS = "Avistamentos"

geolocator = Nominatim(user_agent="PetAlertaSCS_App")

# --- INICIALIZAÇÃO DE ESTADOS ---
if 'pagina' not in st.session_state: st.session_state.pagina = 'home'
if 'logado' not in st.session_state: st.session_state.logado = False
if 'user' not in st.session_state: st.session_state.user = {}
if 'temp_lat' not in st.session_state: st.session_state.temp_lat = None
if 'temp_lng' not in st.session_state: st.session_state.temp_lng = None
if 'user_lat' not in st.session_state: st.session_state.user_lat = None
if 'user_lng' not in st.session_state: st.session_state.user_lng = None
if 'pet_foco' not in st.session_state: st.session_state.pet_foco = None
if 'map_address' not in st.session_state: st.session_state.map_address = None
if 'pagina_detalhes' not in st.session_state: st.session_state.pagina_detalhes = None

SCS_COORDS = [-29.7182, -52.4306]

# --- CONEXÃO G-SHEETS ---
from streamlit_gsheets import GSheetsConnection
conn = st.connection("gsheets", type=GSheetsConnection)

# ==========================================
# 📢 SISTEMA DE POP-UPS (MODAIS)
# ==========================================
@st.dialog("Sucesso!")
def modal_sucesso(mensagem, proxima_pagina='home'):
    st.write(f"### 🎉 {mensagem}")
    if st.button("OK", width='stretch', type="primary"):
        st.session_state.pagina = proxima_pagina
        st.session_state.temp_lat, st.session_state.temp_lng, st.session_state.map_address = None, None, None
        st.rerun()

# --- FUNÇÕES GLOBAIS ---
def ler_planilha_direto(nome_aba):
    try:
        df = conn.read(worksheet=nome_aba, ttl=15, dtype=str)
        return df.dropna(how='all').fillna("")
    except:
        return pd.DataFrame()

def fazer_upload_imgbb(arquivo):
    if arquivo:
        try:
            url = f"https://api.imgbb.com/1/upload?key={IMGBB_API_KEY}"
            img_b64 = base64.b64encode(arquivo.getvalue()).decode('utf-8')
            response = requests.post(url, data={"image": img_b64})
            data = response.json()
            if data.get("status") == 200: return data["data"]["url"]
        except: pass
    return ""

def valor_seguro(linha, coluna):
    pet_dict = dict(linha)
    col_buscada = coluna.lower().replace('ç','c').replace('é','e').replace('í','i').replace('á','a').replace('_', '').replace(' ', '')
    for chave, valor in pet_dict.items():
        if str(chave).lower().replace('ç','c').replace('é','e').replace('í','i').replace('á','a').replace('_', '').replace(' ', '').strip() == col_buscada:
            v = str(valor).strip()
            return v if v not in ['nan', 'none', ''] else '-'
    return '-'

def obter_endereco(lat, lng):
    try:
        location = geolocator.reverse((lat, lng), timeout=5)
        if location:
            address = location.raw.get('address', {})
            rua = address.get('road', 'Rua não identificada')
            bairro = address.get('suburb', address.get('neighbourhood', 'Bairro não identificado'))
            return f"{rua}, {bairro}"
    except: pass
    return "Localização capturada"

# --- CSS ADAPTÁVEL ---
st.markdown("""
<style>
    [data-testid="stVerticalBlockBorderWrapper"] > div { border-radius: 12px !important; padding: 10px !important; margin-bottom: 15px !important; }
    .html-card-wrapper { display: flex; gap: 15px; align-items: flex-start; color: var(--text-color) !important; font-family: var(--font) !important; }
    .titulo-card { color: var(--text-color) !important; margin: 0px !important; line-height: 1.0 !important; font-size: 1.3rem !important; font-weight: bold !important; }
    .texto-card { color: var(--text-color) !important; margin: 2px 0px !important; font-size: 0.95rem !important; line-height: 1.2 !important; }
    .foto-card { width: 120px !important; height: 120px !important; object-fit: cover !important; border-radius: 10px !important; border: 1px solid var(--secondary-background-color) !important; }
    .avistamento-alerta { color: #FF4B4B !important; font-weight: bold !important; }
    .titulo-hall { color: #2ECC71 !important; margin:0; }
</style>
""", unsafe_allow_html=True)

def ir_para(p):
    st.session_state.pagina = p
    st.session_state.pagina_detalhes = None
    st.rerun()

# --- PÁGINA DE ZOOM ---
if st.session_state.pagina_detalhes:
    st.image(st.session_state.pagina_detalhes, width='stretch')
    if st.button("⬅️ VOLTAR", width='stretch', type="primary"):
        st.session_state.pagina_detalhes = None
        st.rerun()
    st.stop()

# ==========================================
# 🛰️ GPS EM TEMPO REAL (BACKGROUND)
# ==========================================
loc_gps = streamlit_js_eval(js_expressions="new Promise(resolve => navigator.geolocation.getCurrentPosition(pos => resolve({lat: pos.coords.latitude, lng: pos.coords.longitude})))", key="gps_tracker")
if loc_gps:
    st.session_state.user_lat, st.session_state.user_lng = loc_gps['lat'], loc_gps['lng']

# --- SIDEBAR ---
with st.sidebar:
    st.title("🐾 Menu")
    if st.button("🏠 Início (Mural)", width='stretch'): ir_para('home')
    if st.button("🏆 Hall da Fama", width='stretch'): ir_para('hall_fama')
    st.divider()
    if not st.session_state.logado:
        st.subheader("Entrar")
        u_l, p_l = st.text_input("Usuário"), st.text_input("Senha", type="password")
        if st.button("Entrar", width='stretch', type="primary"):
            df_u = ler_planilha_direto(ABA_USUARIOS)
            user_found = next((r.to_dict() for _, r in df_u.iterrows() if str(r.get('Usuario', '')).lower() == u_l.strip().lower() and str(r.get('Senha', '')).replace('.0', '') == p_l.strip()), None)
            if user_found: 
                st.session_state.logado, st.session_state.user = True, user_found
                st.rerun()
            else: st.error("Login inválido")
        if st.button("Criar Conta", width='stretch'): ir_para('cadastro_user')
    else:
        st.success(f"Olá, {st.session_state.user.get('Nome', 'Usuário').split()[0]}")
        if st.button("🐾 Meus Pets", width='stretch'): ir_para('meus_pets')
        if st.button("🚪 Sair", width='stretch'): 
            st.session_state.logado = False
            ir_para('home')

# --- PÁGINA: HOME ---
if st.session_state.pagina == 'home':
    st.title("🐾 PetAlerta Santa Cruz do Sul")
    df, df_avis = ler_planilha_direto(ABA_PETS), ler_planilha_direto(ABA_AVISTAMENTOS)
    
    # 🚨 RADAR DE PROXIMIDADE (1KM)
    if st.session_state.user_lat and not df.empty:
        count_prox = 0
        user_pos = (st.session_state.user_lat, st.session_state.user_lng)
        for _, p in df.iterrows():
            if valor_seguro(p, 'Status') == 'Perdido':
                try:
                    dist = geodesic(user_pos, (float(p['Lat']), float(p['Lng']))).km
                    if dist <= 1.0: count_prox += 1
                except: continue
        if count_prox > 0:
            st.warning(f"🚨 **RADAR:** Existem {count_prox} pets perdidos em um raio de 1km de você! Fique atento(a).")

    # MAPA
    m = folium.Map(location=SCS_COORDS, zoom_start=14)
    if st.session_state.user_lat:
        folium.Circle(location=[st.session_state.user_lat, st.session_state.user_lng], radius=150, color='#3498db', fill=True, fill_opacity=0.2).add_to(m)
        folium.Marker([st.session_state.user_lat, st.session_state.user_lng], icon=folium.Icon(color='blue', icon='user', prefix='fa')).add_to(m)

    if not df.empty:
        for _, pet in df.iterrows():
            if valor_seguro(pet, 'Status') == 'Perdido':
                esp = valor_seguro(pet, 'Especie').lower()
                icon_n, icon_c = ('dog', 'orange') if 'cão' in esp or 'cao' in esp else ('cat', 'blue')
                l_p, n_p = valor_seguro(pet, 'Lat'), valor_seguro(pet, 'Lng')
                if not df_avis.empty:
                    avis = df_avis[df_avis['ID_Pet'] == str(valor_seguro(pet, 'ID')).strip()]
                    if not avis.empty: l_p, n_p, icon_c = avis.iloc[-1]['Lat'], avis.iloc[-1]['Lng'], 'red'
                if l_p != '-':
                    folium.Marker([float(l_p), float(n_p)], popup=valor_seguro(pet, 'Nome_Pet'), icon=folium.Icon(color=icon_c, icon=icon_n, prefix='fa')).add_to(m)
    
    st_folium(m, width='stretch', height=400)
    if st.session_state.logado:
        if st.button("🚨 REGISTRAR NOVO PET", type="primary", width='stretch'): ir_para('perdi_pet')

    st.subheader("🔍 Mural de Desaparecidos")
    for _, pet in df.iterrows():
        if valor_seguro(pet, 'Status') == 'Perdido':
            with st.container(border=True):
                pet_id, nome = str(valor_seguro(pet, 'ID')).strip(), valor_seguro(pet, 'Nome_Pet')
                loc = f"📍 <span class='avistamento-alerta'>Sumiu em:</span> {valor_seguro(pet, 'Local_Desaparecimento')} ({valor_seguro(pet, 'Data')})"
                if not df_avis.empty:
                    avis = df_avis[df_avis['ID_Pet'] == pet_id]
                    if not avis.empty: loc = f"<span class='avistamento-alerta'>🚨 Último avistamento:</span> {avis.iloc[-1].get('Bairro', '')} ({avis.iloc[-1].get('Data_Hora', '')})"
                
                st.markdown(f'''<div class="html-card-wrapper"><img src="{valor_seguro(pet, 'Foto')}" class="foto-card" onerror="this.style.display='none'"><div style="flex: 1;"><h3 class="titulo-card">{nome}</h3><p class="texto-card"><b>Espécie:</b> {valor_seguro(pet, 'Especie')} | <b>Raça:</b> {valor_seguro(pet, 'Raca')}</p><p class="texto-card">{loc}</p></div></div>''', unsafe_allow_html=True)
                
                c1, c2, c3, c4 = st.columns(4)
                if st.session_state.logado:
                    with c1: 
                        if valor_seguro(pet, 'Foto') != '-' and st.button("🔍 Foto", key=f"f_logged_{pet_id}", width='stretch'): 
                            st.session_state.pagina_detalhes = valor_seguro(pet, 'Foto')
                            st.rerun()
                    with c2: 
                        tel = "".join(filter(str.isdigit, valor_seguro(pet, 'Tel_Tutor')))
                        if len(tel) >= 10: st.link_button("🟢 Whats", f"https://wa.me/55{tel}", width='stretch')
                    with c3: 
                        if st.button("👁️ Vi!", key=f"v_{pet_id}", width='stretch'): 
                            st.session_state.pet_foco = dict(pet)
                            ir_para('novo_avistamento')
                    with c4:
                        if st.button("🗺️ Rota", key=f"r_{pet_id}", width='stretch'): 
                            st.session_state.pet_foco = dict(pet)
                            ir_para('historico_pet')
                else:
                    with c1:
                        if valor_seguro(pet, 'Foto') != '-' and st.button("🔍 Foto", key=f"f_guest_{pet_id}", width='stretch'):
                            st.session_state.pagina_detalhes = valor_seguro(pet, 'Foto')
                            st.rerun()
                    with c2:
                        st.button("🔒 Login p/ Contato", key=f"log_btn_{pet_id}", disabled=True, width='stretch')

# --- PÁGINA: REGISTRO PET ---
elif st.session_state.pagina == 'perdi_pet':
    st.header("🚨 Registrar Pet Perdido")
    st.info("Clique no mapa para marcar o local exato.")
    if st.button("⬅️ Voltar"): ir_para('home')
    
    m_reg = folium.Map(location=[st.session_state.user_lat, st.session_state.user_lng] if st.session_state.user_lat else SCS_COORDS, zoom_start=16)
    if st.session_state.temp_lat: folium.Marker([st.session_state.temp_lat, st.session_state.temp_lng], icon=folium.Icon(color='red')).add_to(m_reg)
    
    map_res = st_folium(m_reg, width=700, height=300, key="map_reg")
    if map_res and map_res.get("last_clicked"):
        st.session_state.temp_lat, st.session_state.temp_lng = map_res["last_clicked"]["lat"], map_res["last_clicked"]["lng"]
        with st.spinner("Convertendo endereço..."): st.session_state.map_address = obter_endereco(st.session_state.temp_lat, st.session_state.temp_lng)
        st.rerun()

    if st.session_state.map_address: st.success(f"📍 Local capturado: **{st.session_state.map_address}**")

    with st.form("f_pet"):
        n_p, esp = st.text_input("Nome do Pet*"), st.selectbox("Espécie", ["Cão", "Gato"])
        raca, cor, caract = st.text_input("Raça"), st.text_input("Cor"), st.text_area("Características")
        bairro, foto = st.text_input("Referência (Opcional)"), st.file_uploader("Foto")
        if st.form_submit_button("🚀 PUBLICAR"):
            if n_p and st.session_state.temp_lat:
                url_f = fazer_upload_imgbb(foto)
                d = {"ID": str(int(datetime.now().timestamp())), "Status": "Perdido", "Data": datetime.now().strftime('%d/%m/%Y'), "Especie": esp, "Nome_Pet": n_p, "Raca": raca, "Cor": cor, "Caracteristicas": caract, "Local_Desaparecimento": f"{st.session_state.map_address} - {bairro}" if bairro else st.session_state.map_address, "Lat": str(st.session_state.temp_lat), "Lng": str(st.session_state.temp_lng), "Foto": url_f, "User_Vinculo": st.session_state.user.get('Usuario', ''), "Tel_Tutor": st.session_state.user.get('Telefone', '')}
                df_p = ler_planilha_direto(ABA_PETS)
                conn.update(worksheet=ABA_PETS, data=pd.concat([df_p, pd.DataFrame([d])], ignore_index=True))
                st.cache_data.clear()
                modal_sucesso("Pet registrado com sucesso!")
            else: st.error("Preencha o nome e indique o local no mapa.")

# --- PÁGINA: NOVO AVISTAMENTO ---
elif st.session_state.pagina == 'novo_avistamento':
    pet = st.session_state.pet_foco
    st.header(f"👁️ Vi o pet: {valor_seguro(pet, 'Nome_Pet')}")
    if st.button("⬅️ Voltar"): ir_para('home')
    m_avi = folium.Map(location=SCS_COORDS, zoom_start=15)
    if st.session_state.temp_lat: folium.Marker([st.session_state.temp_lat, st.session_state.temp_lng], icon=folium.Icon(color='red')).add_to(m_avi)
    map_res = st_folium(m_avi, width=700, height=300, key="map_avi")
    if map_res and map_res.get("last_clicked"):
        st.session_state.temp_lat, st.session_state.temp_lng = map_res["last_clicked"]["lat"], map_res["last_clicked"]["lng"]; st.rerun()
    with st.form("f_avis"):
        ref, obs = st.text_input("Referência"), st.text_area("Observações")
        if st.form_submit_button("📍 SALVAR"):
            if st.session_state.temp_lat:
                end_r = obter_endereco(st.session_state.temp_lat, st.session_state.temp_lng)
                novo = {"ID_Pet": valor_seguro(pet, 'ID'), "Data_Hora": datetime.now().strftime('%d/%m/%Y %H:%M'), "Lat": str(st.session_state.temp_lat), "Lng": str(st.session_state.temp_lng), "Bairro": f"{end_r} - {ref}" if ref else end_r, "Observacao": obs, "Usuario": st.session_state.user.get('Usuario', '')}
                df_av = ler_planilha_direto(ABA_AVISTAMENTOS)
                conn.update(worksheet=ABA_AVISTAMENTOS, data=pd.concat([df_av, pd.DataFrame([novo])], ignore_index=True))
                st.cache_data.clear(); modal_sucesso("Avistamento registrado!")

# --- PÁGINA: ROTA ---
elif st.session_state.pagina == 'historico_pet':
    pet = st.session_state.pet_foco
    st.header(f"🗺️ Rota: {valor_seguro(pet, 'Nome_Pet')}")
    if st.button("⬅️ Voltar"): ir_para('home')
    df_avis = ler_planilha_direto(ABA_AVISTAMENTOS)
    avis = df_avis[df_avis['ID_Pet'] == str(valor_seguro(pet, 'ID')).strip()]
    l_o, n_o = float(valor_seguro(pet, 'Lat')), float(valor_seguro(pet, 'Lng'))
    m_h = folium.Map(location=[l_o, n_o], zoom_start=14)
    pontos = [[l_o, n_o]]
    folium.Marker([l_o, n_o], icon=folium.Icon(color='black', icon='home', prefix='fa')).add_to(m_h)
    for _, av in avis.iterrows():
        pontos.append([float(av['Lat']), float(av['Lng'])]); folium.Marker([float(av['Lat']), float(av['Lng'])], icon=folium.Icon(color='red', icon='eye', prefix='fa')).add_to(m_h)
    folium.PolyLine(pontos, color="red").add_to(m_h)
    st_folium(m_h, width='stretch', height=400)

# --- PÁGINA: HALL DA FAMA ---
elif st.session_state.pagina == 'hall_fama':
    st.title("🏆 Hall da Fama")
    df = ler_planilha_direto(ABA_PETS)
    for _, pet in df.iterrows():
        if valor_seguro(pet, 'Status') == 'Encontrado':
            pet_id = valor_seguro(pet, 'ID')
            with st.container(border=True):
                st.markdown(f'''<div class="html-card-wrapper"><img src="{valor_seguro(pet, 'Foto')}" class="foto-card"><div><h3 style="color:#2ECC71;">🎉 {valor_seguro(pet, 'Nome_Pet')}</h3><p>Já está em casa! ❤️</p></div></div>''', unsafe_allow_html=True)
                if valor_seguro(pet, 'Foto') != '-' and st.button("🔍 Foto", key=f"z_{pet_id}", width='stretch'):
                    st.session_state.pagina_detalhes = valor_seguro(pet, 'Foto')
                    st.rerun()

# --- PÁGINA: MEUS PETS ---
elif st.session_state.pagina == 'meus_pets':
    st.header("🐾 Minhas Publicações")
    df = ler_planilha_direto(ABA_PETS)
    u_log = str(st.session_state.user.get('Usuario', '')).lower()
    meus = df[df.apply(lambda r: str(r.get('User_Vinculo', '')).lower() == u_log, axis=1)]
    for idx, pet in meus.iterrows():
        with st.container(border=True):
            st.subheader(valor_seguro(pet, 'Nome_Pet'))
            if valor_seguro(pet, 'Status') == 'Perdido':
                if st.button("🎉 ENCONTRADO", key=f"e_{idx}", type="primary", width='stretch'):
                    df.loc[idx, 'Status'] = 'Encontrado'
                    conn.update(worksheet=ABA_PETS, data=df)
                    st.cache_data.clear()
                    modal_sucesso("Pet localizado!")

# --- PÁGINA: CADASTRO ---
elif st.session_state.pagina == 'cadastro_user':
    st.header("📝 Criar Conta")
    if st.button("⬅️ Voltar"): ir_para('home')
    with st.form("cad"):
        n, t, u, p = st.text_input("Nome"), st.text_input("Whats"), st.text_input("User"), st.text_input("Senha", type="password")
        end_user = st.text_input("Seu Endereço (Rua, Número, Bairro, SCS)")
        if st.form_submit_button("CADASTRAR"):
            l_u, n_u = 0, 0
            try:
                loc = geolocator.geocode(end_user)
                if loc: l_u, n_u = loc.latitude, loc.longitude
            except: pass
            novo = {"Usuario":u, "Senha":p, "Telefone":t, "Nome":n, "Endereco":end_user, "Lat_Residencia": str(l_u), "Lng_Residencia": str(n_u)}
            conn.update(worksheet=ABA_USUARIOS, data=pd.concat([ler_planilha_direto(ABA_USUARIOS), pd.DataFrame([novo])], ignore_index=True))
            st.cache_data.clear()
            modal_sucesso("Conta criada!")
