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
import os

# 1. Configuração Inicial
st.set_page_config(page_title="PetAlerta SCS", page_icon="🐾", layout="centered")

# --- CONFIGURAÇÕES TÉCNICAS ---
IMGBB_API_KEY = "54494e69c28056a133620f4e8be0ab72"
ABA_USUARIOS, ABA_PETS, ABA_AVISTAMENTOS = "Usuarios", "Dados", "Avistamentos"
geolocator = Nominatim(user_agent="PetAlertaSCS_Final_UI")
SCS_COORDS = [-29.7182, -52.4306]

# --- CONEXÃO G-SHEETS ---
from streamlit_gsheets import GSheetsConnection
conn = st.connection("gsheets", type=GSheetsConnection)

# --- INICIALIZAÇÃO DE ESTADOS ---
for key in ['pagina', 'logado', 'user', 'user_lat', 'user_lng', 'temp_lat', 'temp_lng', 'map_address', 'pet_foco', 'pagina_detalhes']:
    if key not in st.session_state:
        st.session_state[key] = None if key in ['user_lat', 'user_lng', 'temp_lat', 'temp_lng', 'map_address', 'pet_foco', 'pagina_detalhes'] else False
if not st.session_state.pagina: st.session_state.pagina = 'home'

# ==========================================
# 🎨 FRONT-END: CSS PREMIUM COMPACTO V3
# ==========================================
st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600&display=swap');
    html, body, [class*="css"] { font-family: 'Poppins', sans-serif; }

    .header-banner { width: 100% !important; border-radius: 15px !important; margin-bottom: 15px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }

    /* CARD COM ALTURA FIXA E 4 BOTÕES ALINHADOS */
    [data-testid="stVerticalBlockBorderWrapper"] {
        background-color: var(--secondary-background-color) !important;
        border: 1px solid rgba(128, 128, 128, 0.1) !important;
        border-radius: 20px !important;
        padding: 12px !important;
        height: 265px !important; /* Altura ajustada para 4 botões lado a lado */
        display: flex; flex-direction: column; justify-content: space-between;
        transition: 0.3s ease;
    }
    [data-testid="stVerticalBlockBorderWrapper"]:hover { border: 1px solid #ff4b4b !important; transform: scale(1.01); }

    .stImage img { border-radius: 12px !important; height: 110px !important; object-fit: cover !important; }
    .nome-pet { color: var(--text-color) !important; font-size: 1.2rem !important; font-weight: 600 !important; margin: 0; }
    .tag-status { background-color: #ff4b4b; color: white; padding: 1px 8px; border-radius: 6px; font-size: 0.6rem; font-weight: 700; margin-left: 8px; vertical-align: middle; }
    
    .info-container { font-size: 0.78rem; color: var(--text-color); margin-top: 5px; height: 55px; overflow-y: auto; }
    .info-label { opacity: 0.6; font-weight: 400; }
    .info-valor { font-weight: 500; }

    /* Botões Pequenos para caberem 4 na linha */
    .stButton>button { border-radius: 10px !important; font-size: 0.6rem !important; height: 32px !important; padding: 0px !important; }
    .stFolium { border-radius: 20px !important; }
</style>
""", unsafe_allow_html=True)

# --- FUNÇÕES CORE ---
def ler_planilha(aba):
    try: return conn.read(worksheet=aba, ttl=5).dropna(how='all').fillna("")
    except: return pd.DataFrame()

def fazer_upload_imgbb(arquivo):
    if not arquivo: return ""
    try:
        url = f"https://api.imgbb.com/1/upload?key={IMGBB_API_KEY}"
        img_b64 = base64.b64encode(arquivo.getvalue()).decode('utf-8')
        response = requests.post(url, data={"image": img_b64})
        return response.json()["data"]["url"] if response.status_code == 200 else ""
    except: return ""

def obter_endereco(lat, lng):
    try:
        location = geolocator.reverse((lat, lng), timeout=5)
        if location:
            address = location.raw.get('address', {})
            return f"{address.get('road', 'Rua não ident.')}, {address.get('suburb', 'Bairro não ident.')}"
    except: return "Localização capturada"

def ir_para(p):
    st.session_state.pagina = p
    st.rerun()

def renderizar_header():
    banner_path = "assets/Banner.png"
    if os.path.exists(banner_path):
        with open(banner_path, "rb") as f:
            data = base64.b64encode(f.read()).decode()
            st.markdown(f'<img src="data:image/png;base64,{data}" class="header-banner">', unsafe_allow_html=True)

# ==========================================
# 📢 SISTEMA DE MODAIS (POP-UPS)
# ==========================================
@st.dialog("Acesso Restrito 🔒")
def modal_login_requerido():
    st.write("### Identificação Necessária")
    st.warning("Para garantir a segurança dos tutores e evitar informações falsas, você precisa estar logado para realizar esta ação.")
    st.write("Deseja criar uma conta agora ou fazer login?")
    c1, c2 = st.columns(2)
    with c1:
        if st.button("Criar Conta", use_container_width=True, type="primary"):
            st.session_state.pagina = 'cadastro_user'; st.rerun()
    with c2:
        st.info("Use o menu lateral para entrar.")

@st.dialog("Sucesso!")
def modal_sucesso(msg, p='home'):
    st.success(msg)
    if st.button("OK", use_container_width=True): ir_para(p)

# ==========================================
# 🛰️ GPS E SIDEBAR
# ==========================================
loc_gps = streamlit_js_eval(js_expressions="new Promise(resolve => navigator.geolocation.getCurrentPosition(pos => resolve({lat: pos.coords.latitude, lng: pos.coords.longitude})))", key="gps")
if loc_gps: st.session_state.user_lat, st.session_state.user_lng = loc_gps['lat'], loc_gps['lng']

with st.sidebar:
    st.markdown("### 🐾 PetAlerta SCS")
    if st.button("🏠 Mural de Pets", use_container_width=True): ir_para('home')
    if st.button("🏆 Hall da Fama", use_container_width=True): ir_para('hall_fama')
    st.divider()
    if not st.session_state.logado:
        u = st.text_input("Usuário")
        p = st.text_input("Senha", type="password")
        if st.button("Entrar", type="primary", use_container_width=True):
            df_u = ler_planilha(ABA_USUARIOS)
            user = df_u[(df_u['Usuario'].astype(str).str.lower() == u.lower()) & (df_u['Senha'].astype(str) == p)].to_dict('records')
            if user: st.session_state.logado, st.session_state.user = True, user[0]; st.rerun()
            else: st.error("Login inválido")
        if st.button("Criar Conta", use_container_width=True): ir_para('cadastro_user')
    else:
        st.success(f"Olá, {st.session_state.user['Nome'].split()[0]}")
        if st.button("🐾 Meus Pets", use_container_width=True): ir_para('meus_pets')
        if st.button("🚪 Sair", use_container_width=True): st.session_state.logado = False; st.rerun()

renderizar_header()

if st.session_state.pagina_detalhes:
    st.image(st.session_state.pagina_detalhes, use_container_width=True)
    if st.button("⬅️ VOLTAR AO MURAL", use_container_width=True, type="primary"):
        st.session_state.pagina_detalhes = None; st.rerun()
    st.stop()

# ==========================================
# 🏠 PÁGINA: HOME (MURAL)
# ==========================================
if st.session_state.pagina == 'home':
    df_p = ler_planilha(ABA_PETS)
    df_a = ler_planilha(ABA_AVISTAMENTOS)

    # MAPA
    m = folium.Map(location=SCS_COORDS, zoom_start=14, tiles='cartodbpositron')
    for _, pet in df_p[df_p['Status'] == 'Perdido'].iterrows():
        esp = str(pet['Especie']).lower()
        ic = 'dog' if 'cão' in esp or 'cao' in esp else 'cat' if 'gato' in esp else 'paw'
        avis_pet = df_a[df_a['ID_Pet'].astype(str) == str(pet['ID'])]
        lat, lng, cor = pet['Lat'], pet['Lng'], 'orange'
        if not avis_pet.empty:
            ultimo = avis_pet.iloc[-1]
            lat, lng, cor = ultimo['Lat'], ultimo['Lng'], 'red'
        folium.Marker([lat, lng], popup=pet['Nome_Pet'], icon=folium.Icon(color=cor, icon=ic, prefix='fa')).add_to(m)
    
    st_folium(m, use_container_width=True, height=350)

    st.subheader("🔍 Mural de Desaparecidos")
    for _, pet in df_p[df_p['Status'] == 'Perdido'].iterrows():
        p_id = str(pet['ID'])
        avis_pet = df_a[df_a['ID_Pet'].astype(str) == p_id]
        label_loc, valor_loc = ("Visto em:", f"{avis_pet.iloc[-1]['Bairro']} ({avis_pet.iloc[-1]['Data_Hora']})") if not avis_pet.empty else ("Sumiu em:", f"{pet['Local_Desaparecimento']} ({pet['Data']})")

        with st.container(border=True):
            c_img, c_txt = st.columns([1, 2.2])
            with c_img: st.image(pet['Foto'], use_container_width=True)
            with c_txt:
                st.markdown(f"<div><span class='nome-pet'>{pet['Nome_Pet']}</span><span class='tag-status'>PERDIDO</span></div>", unsafe_allow_html=True)
                st.markdown(f"<div class='info-container'><span class='info-label'>{label_loc}</span> <span class='info-valor'>{valor_loc}</span><br><span class='info-label'>🐾 Raça:</span> <span class='info-valor'>{pet['Raca']} ({pet['Cor']})</span></div>", unsafe_allow_html=True)
                
                # 🛠️ DISTRIBUIÇÃO UNIFORME DE 4 BOTÕES LADO A LADO
                b1, b2, b3, b4 = st.columns(4)
                
                with b1: # FOTO (Público)
                    if st.button("🔍 Foto", key=f"f_{p_id}", use_container_width=True): 
                        st.session_state.pagina_detalhes = pet['Foto']; st.rerun()
                
                with b2: # ROTA (Público)
                    if st.button("🗺️ Rota", key=f"r_{p_id}", use_container_width=True): 
                        st.session_state.pet_foco = pet; ir_para('historico_pet')
                
                with b3: # VI ESTE PET! (Restrito)
                    if st.button("👁️ Vi!", key=f"vi_{p_id}", use_container_width=True):
                        if st.session_state.logado:
                            st.session_state.pet_foco = pet; ir_para('novo_avistamento')
                        else:
                            modal_login_requerido()
                
                with b4: # WHATSAPP (Restrito)
                    if st.button("🟢 Whats", key=f"wa_{p_id}", use_container_width=True):
                        if st.session_state.logado:
                            tel = "".join(filter(str.isdigit, str(pet['Tel_Tutor'])))
                            st.markdown(f'<meta http-equiv="refresh" content="0; url=https://wa.me/55{tel}">', unsafe_allow_html=True)
                        else:
                            modal_login_requerido()

# --- PÁGINAS DE SUPORTE MANTIDAS (PERDI_PET, NOVO_AVISTAMENTO, HALL_FAMA, CADASTRO, MEUS_PETS) ---
elif st.session_state.pagina == 'perdi_pet':
    st.header("🚨 Registrar Pet Perdido")
    if st.button("⬅️ Voltar"): ir_para('home')
    m_reg = folium.Map(location=SCS_COORDS, zoom_start=15)
    if st.session_state.temp_lat: folium.Marker([st.session_state.temp_lat, st.session_state.temp_lng], icon=folium.Icon(color='red')).add_to(m_reg)
    map_res = st_folium(m_reg, use_container_width=True, height=300, key="map_reg")
    if map_res and map_res.get("last_clicked"):
        st.session_state.temp_lat, st.session_state.temp_lng = map_res["last_clicked"]["lat"], map_res["last_clicked"]["lng"]
        st.session_state.map_address = obter_endereco(st.session_state.temp_lat, st.session_state.temp_lng); st.rerun()
    if st.session_state.map_address: st.success(f"📍 Local: {st.session_state.map_address}")
    with st.form("f_pet"):
        n_p, esp = st.text_input("Nome do Pet*"), st.selectbox("Espécie", ["Cão", "Gato"])
        raca, cor, foto = st.text_input("Raça"), st.text_input("Cor"), st.file_uploader("Foto")
        if st.form_submit_button("🚀 PUBLICAR"):
            if n_p and st.session_state.temp_lat:
                url_f = fazer_upload_imgbb(foto)
                novo = pd.DataFrame([{"ID": str(int(datetime.now().timestamp())), "Status": "Perdido", "Data": datetime.now().strftime('%d/%m/%Y'), "Especie": esp, "Nome_Pet": n_p, "Raca": raca, "Cor": cor, "Local_Desaparecimento": st.session_state.map_address, "Lat": st.session_state.temp_lat, "Lng": st.session_state.temp_lng, "Foto": url_f, "User_Vinculo": st.session_state.user['Usuario'], "Tel_Tutor": st.session_state.user['Telefone']}])
                conn.update(worksheet=ABA_PETS, data=pd.concat([ler_planilha(ABA_PETS), novo], ignore_index=True))
                modal_sucesso("Pet publicado no mural!")

elif st.session_state.pagina == 'novo_avistamento':
    p = st.session_state.pet_foco
    st.header(f"👁️ Vi o pet: {p['Nome_Pet']}")
    if st.button("⬅️ Voltar"): ir_para('home')
    m_av = folium.Map(location=[p['Lat'], p['Lng']], zoom_start=15)
    if st.session_state.temp_lat: folium.Marker([st.session_state.temp_lat, st.session_state.temp_lng], icon=folium.Icon(color='red')).add_to(m_av)
    map_res = st_folium(m_av, use_container_width=True, height=300, key="map_av")
    if map_res and map_res.get("last_clicked"):
        st.session_state.temp_lat, st.session_state.temp_lng = map_res["last_clicked"]["lat"], map_res["last_clicked"]["lng"]; st.rerun()
    with st.form("f_av"):
        obs = st.text_area("Observações")
        if st.form_submit_button("📍 SALVAR"):
            if st.session_state.temp_lat:
                end_r = obter_endereco(st.session_state.temp_lat, st.session_state.temp_lng)
                novo = pd.DataFrame([{"ID_Pet": p['ID'], "Data_Hora": datetime.now().strftime('%d/%m/%Y %H:%M'), "Lat": st.session_state.temp_lat, "Lng": st.session_state.temp_lng, "Bairro": end_r, "Usuario": st.session_state.user['Usuario']}])
                conn.update(worksheet=ABA_AVISTAMENTOS, data=pd.concat([ler_planilha(ABA_AVISTAMENTOS), novo], ignore_index=True))
                modal_sucesso("Avistamento registrado!")

elif st.session_state.pagina == 'historico_pet':
    p = st.session_state.pet_foco
    st.header(f"🗺️ Rota: {p['Nome_Pet']}")
    if st.button("⬅️ Voltar"): ir_para('home')
    df_a = ler_planilha(ABA_AVISTAMENTOS)
    avis = df_a[df_a['ID_Pet'].astype(str) == str(p['ID'])]
    m_h = folium.Map(location=[p['Lat'], p['Lng']], zoom_start=14)
    pontos = [[p['Lat'], p['Lng']]]
    folium.Marker([p['Lat'], p['Lng']], popup="Sumiu", icon=folium.Icon(color='black', icon='home')).add_to(m_h)
    for _, a in avis.iterrows():
        pontos.append([a['Lat'], a['Lng']])
        folium.Marker([a['Lat'], a['Lng']], popup=a['Data_Hora'], icon=folium.Icon(color='red', icon='eye')).add_to(m_h)
    folium.PolyLine(pontos, color="red", weight=2.5).add_to(m_h)
    st_folium(m_h, use_container_width=True, height=400)

elif st.session_state.pagina == 'hall_fama':
    st.header("🏆 Hall da Fama")
    if st.button("⬅️ Voltar"): ir_para('home')
    df = ler_planilha(ABA_PETS)
    for _, pet in df[df['Status'] == 'Encontrado'].iterrows():
        with st.container(border=True):
            st.image(pet['Foto'], width=150); st.subheader(f"🎉 {pet['Nome_Pet']} está em casa!")

elif st.session_state.pagina == 'meus_pets':
    st.header("🐾 Meus Pets")
    if st.button("⬅️ Voltar"): ir_para('home')
    df = ler_planilha(ABA_PETS)
    meus = df[df['User_Vinculo'] == st.session_state.user['Usuario']]
    for idx, pet in meus.iterrows():
        with st.container(border=True):
            st.write(f"**{pet['Nome_Pet']}**")
            if pet['Status'] == 'Perdido' and st.button(f"🎉 Marcar como Encontrado", key=f"e_{idx}"):
                df.at[idx, 'Status'] = 'Encontrado'; conn.update(worksheet=ABA_PETS, data=df); modal_sucesso("Ótima notícia!", 'meus_pets')

elif st.session_state.pagina == 'cadastro_user':
    st.header("📝 Criar Conta")
    if st.button("⬅️ Voltar"): ir_para('home')
    with st.form("c_user"):
        n, u, p, t = st.text_input("Nome"), st.text_input("Usuário"), st.text_input("Senha", type="password"), st.text_input("Whats")
        if st.form_submit_button("CADASTRAR"):
            novo = pd.DataFrame([{"Usuario":u, "Senha":p, "Nome":n, "Telefone":t}])
            conn.update(worksheet=ABA_USUARIOS, data=pd.concat([ler_planilha(ABA_USUARIOS), novo], ignore_index=True))
            modal_sucesso("Conta criada!")
