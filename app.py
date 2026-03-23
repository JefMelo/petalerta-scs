import streamlit as st
import pandas as pd
from datetime import datetime
import requests
import base64
import folium
from streamlit_folium import st_folium
from streamlit_js_eval import streamlit_js_eval
from geopy.geocoders import Nominatim
import os

# 1. CONFIGURAÇÃO DA PÁGINA
st.set_page_config(page_title="PetAlerta SCS", page_icon="🐾", layout="centered")

# --- CREDENCIAIS E APIS ---
IMGBB_API_KEY = "54494e69c28056a133620f4e8be0ab72"
ABA_USUARIOS, ABA_PETS, ABA_AVISTAMENTOS, ABA_ADOCAO = "Usuarios", "Dados", "Avistamentos", "Adocao"
geolocator = Nominatim(user_agent="PetAlertaSCS_V3_Final")
SCS_COORDS = [-29.7182, -52.4306]

# --- CONEXÃO G-SHEETS ---
from streamlit_gsheets import GSheetsConnection
conn = st.connection("gsheets", type=GSheetsConnection)

# --- ESTADOS (STATE) ---
for key in ['pagina', 'logado', 'user', 'user_lat', 'user_lng', 'temp_lat', 'temp_lng', 'map_address', 'pet_foco', 'pagina_detalhes']:
    if key not in st.session_state:
        st.session_state[key] = None if key in ['user_lat', 'user_lng', 'temp_lat', 'temp_lng', 'map_address', 'pet_foco', 'pagina_detalhes'] else False
if not st.session_state.pagina: st.session_state.pagina = 'home'

# ==========================================
# 🎨 CSS PREMIUM (SIMETRIA 300PX E SOMBRAS)
# ==========================================
st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600&display=swap');
    html, body, [class*="css"] { font-family: 'Poppins', sans-serif; }

    /* BANNER SUPERIOR */
    .banner-container-final { width: 100%; display: flex; justify-content: center; margin-bottom: 25px; }
    .header-banner-final-impl { width: 100%; height: auto; aspect-ratio: 4 / 1; object-fit: contain; border-radius: 18px; box-shadow: 0 10px 25px rgba(0,0,0,0.15); }

    /* CARD COM ALTURA RÍGIDA 300PX */
    [data-testid="stVerticalBlockBorderWrapper"] {
        background-color: var(--secondary-background-color) !important;
        border: 1px solid rgba(128, 128, 128, 0.1) !important;
        border-radius: 22px !important; padding: 12px !important;
        height: 300px !important; min-height: 300px !important; max-height: 300px !important;
        overflow: hidden !important; display: flex !important; flex-direction: column !important; justify-content: space-between !important;
        transition: all 0.3s ease; box-shadow: 0 8px 20px rgba(0,0,0,0.08) !important;
    }
    [data-testid="stVerticalBlockBorderWrapper"]:hover { transform: translateY(-4px); box-shadow: 0 12px 30px rgba(0,0,0,0.12) !important; border: 1px solid #ff4b4b !important; }

    /* FOTO FIXA 120PX */
    [data-testid="stVerticalBlockBorderWrapper"] [data-testid="stImage"] img { 
        border-radius: 12px !important; height: 120px !important; min-height: 120px !important; max-height: 120px !important; object-fit: cover !important; width: 100% !important;
    }
    
    .nome-pet { color: var(--text-color) !important; font-size: 1.2rem !important; font-weight: 600 !important; margin: 0; }
    .tag-status { background-color: #ff4b4b; color: white; padding: 2px 8px; border-radius: 6px; font-size: 0.6rem; font-weight: 700; margin-left: 8px; vertical-align: middle; }
    .tag-adocao { background-color: #4b9fff; color: white; padding: 2px 8px; border-radius: 6px; font-size: 0.6rem; font-weight: 700; margin-left: 8px; vertical-align: middle; }
    
    .info-container { font-size: 0.85rem !important; color: var(--text-color); margin-top: 5px; height: 65px !important; overflow: hidden !important; }
    .info-label { opacity: 0.6; font-weight: 400; }
    .info-valor { font-weight: 500; }

    .stButton>button, .stLinkButton>a { border-radius: 10px !important; font-size: 0.65rem !important; height: 32px !important; font-weight: 600 !important; box-shadow: 0 3px 6px rgba(0,0,0,0.1) !important; }
</style>
""", unsafe_allow_html=True)

# ==========================================
# 🛠️ FUNÇÕES DE APOIO
# ==========================================
def ler_planilha(aba):
    try: return conn.read(worksheet=aba, ttl=5).dropna(how='all').fillna("")
    except: return pd.DataFrame()

def fazer_upload_imgbb(arquivo):
    if not arquivo: return "https://via.placeholder.com/300?text=Sem+Foto"
    try:
        url = f"https://api.imgbb.com/1/upload?key={IMGBB_API_KEY}"
        img_b64 = base64.b64encode(arquivo.getvalue()).decode('utf-8')
        response = requests.post(url, data={"image": img_b64})
        return response.json()["data"]["url"]
    except: return ""

def ir_para(p):
    st.session_state.pagina = p
    st.rerun()

@st.dialog("Acesso Restrito 🔒")
def modal_login_requerido():
    st.warning("Esta funcionalidade exige login.")
    if st.button("Criar Conta Agora", use_container_width=True, type="primary"): ir_para('cadastro_user')

@st.dialog("Sucesso!")
def modal_sucesso(msg, p='home'):
    st.success(msg)
    if st.button("OK", use_container_width=True): ir_para(p)

# ==========================================
# 🛰️ SIDEBAR
# ==========================================
with st.sidebar:
    st.markdown("## 🐾 PetAlerta SCS")
    st.subheader("🔍 Desaparecidos")
    if st.button("📍 Mural de Perdidos", use_container_width=True): ir_para('home')
    st.subheader("🎁 Adoção de Pets")
    if st.button("🏠 Quero Adotar", use_container_width=True): ir_para('adocao_mural')
    if st.button("📢 Quero Anunciar", use_container_width=True): 
        if st.session_state.logado: ir_para('adocao_form')
        else: modal_login_requerido()
    st.subheader("🏆 Histórias")
    if st.button("🎉 Hall da Fama", use_container_width=True): ir_para('hall_fama')
    
    st.divider()
    if not st.session_state.logado:
        u_in = st.text_input("Usuário")
        p_in = st.text_input("Senha", type="password")
        if st.button("Entrar", type="primary", use_container_width=True):
            df_u = ler_planilha(ABA_USUARIOS)
            user = df_u[(df_u['Usuario'].astype(str).str.lower() == u_in.lower()) & (df_u['Senha'].astype(str) == p_in)].to_dict('records')
            if user: st.session_state.logado, st.session_state.user = True, user[0]; st.rerun()
            else: st.error("Login inválido")
    else:
        st.success(f"Olá, {st.session_state.user['Nome'].split()[0]}")
        if st.button("⚙️ Gerenciar Meus Pets", use_container_width=True): ir_para('meus_pets')
        if st.button("🚪 Sair", use_container_width=True): st.session_state.logado = False; ir_para('home')

# --- BANNER ---
banner_path = "assets/Banner.png"
if os.path.exists(banner_path):
    with open(banner_path, "rb") as f: data = base64.b64encode(f.read()).decode()
    st.markdown(f'<div class="banner-container-final"><img src="data:image/png;base64,{data}" class="header-banner-final-impl"></div>', unsafe_allow_html=True)

# ==========================================
# 🏠 PÁGINA 1: PERDIDOS (HOME)
# ==========================================
if st.session_state.pagina == 'home':
    df_p, df_a = ler_planilha(ABA_PETS), ler_planilha(ABA_AVISTAMENTOS)
    m = folium.Map(location=SCS_COORDS, zoom_start=14, tiles='cartodbpositron')
    for _, pet in df_p[df_p['Status'] == 'Perdido'].iterrows():
        folium.Marker([pet['Lat'], pet['Lng']], popup=pet['Nome_Pet'], icon=folium.Icon(color='orange', icon='paw', prefix='fa')).add_to(m)
    st_folium(m, use_container_width=True, height=350)
    
    st.subheader("🔍 Desaparecidos em Santa Cruz")
    for _, pet in df_p[df_p['Status'] == 'Perdido'].iterrows():
        p_id = str(pet['ID'])
        with st.container(border=True):
            c_img, c_txt = st.columns([1, 2.2])
            with c_img: st.image(pet['Foto'], use_container_width=True)
            with c_txt:
                st.markdown(f"<div><span class='nome-pet'>{pet['Nome_Pet']}</span><span class='tag-status'>PERDIDO</span></div>", unsafe_allow_html=True)
                st.markdown(f"<div class='info-container'><span class='info-label'>📍 Sumiu:</span> {pet['Local_Desaparecimento']}<br><span class='info-label'>🐾 Raça:</span> {pet['Raca']}</div>", unsafe_allow_html=True)
                b1, b2, b3, b4 = st.columns(4)
                with b1: st.button("🔍 Foto", key=f"f_{p_id}", on_click=lambda p=pet['Foto']: st.session_state.update({"pagina_detalhes": p}))
                with b2: st.button("🗺️ Rota", key=f"r_{p_id}", on_click=lambda p=pet: st.session_state.update({"pet_foco": p, "pagina": "historico_pet"}))
                with b3: st.button("👁️ Vi!", key=f"vi_{p_id}", on_click=lambda p=pet: st.session_state.update({"pet_foco": p, "pagina": "novo_avistamento"}) if st.session_state.logado else modal_login_requerido())
                with b4: 
                    if st.session_state.logado: st.link_button("🟢 Zap", f"https://wa.me/55{pet['Tel_Tutor']}")
                    else: st.button("🔒 Zap", key=f"w_{p_id}", on_click=modal_login_requerido)

# ==========================================
# 🎁 PÁGINA 2.1: QUERO ADOTAR (MURAL)
# ==========================================
elif st.session_state.pagina == 'adocao_mural':
    st.header("🎁 Encontre um novo amigo")
    df_adocao = ler_planilha(ABA_ADOCAO)
    if df_adocao.empty: st.info("Nenhum pet para adoção.")
    else:
        cols = st.columns(2)
        for idx, pet in df_adocao.iterrows():
            with cols[idx % 2]:
                with st.container(border=True):
                    st.image(pet['Foto'], use_container_width=True)
                    st.markdown(f"<div><span class='nome-pet'>{pet['Nome_Pet']}</span><span class='tag-adocao'>ADOÇÃO</span></div>", unsafe_allow_html=True)
                    st.markdown(f"<div class='info-container'><span class='info-label'>🐾 {pet['Especie']} | {pet['Raca']}</span><br><span class='info-label'>🎂 Idade:</span> {pet['Idade']}</div>", unsafe_allow_html=True)
                    if st.session_state.logado: st.link_button("🎁 Quero Adotar", f"https://wa.me/55{pet['WhatsApp']}")
                    else: st.button("🔒 Quero Adotar", key=f"ad_{idx}", on_click=modal_login_requerido)

# ==========================================
# 📢 PÁGINA 2.2: QUERO ANUNCIAR (AUTOMATIZADA)
# ==========================================
elif st.session_state.pagina == 'adocao_form':
    st.header("📢 Anunciar Pet para Adoção")
    st.info(f"Anunciando como: **{st.session_state.user['Nome']}**")
    
    with st.form("f_adocao"):
        nome_p = st.text_input("Nome do Pet*")
        esp = st.selectbox("Espécie", ["Cão", "Gato"])
        raca, cor, idade = st.text_input("Raça"), st.text_input("Cor"), st.text_input("Idade (ex: 3 meses)")
        obs = st.text_area("Observações")
        foto = st.file_uploader("Foto do Pet*")
        
        if st.form_submit_button("🚀 CADASTRAR PARA ADOÇÃO"):
            if nome_p and foto:
                url_f = fazer_upload_imgbb(foto)
                novo = pd.DataFrame([{
                    "ID": str(int(datetime.now().timestamp())),
                    "Nome_Pet": nome_p, "Especie": esp, "Raca": raca, "Cor": cor,
                    "Idade": idade, "Observacoes": obs, 
                    "Tutor": st.session_state.user['Nome'], 
                    "WhatsApp": st.session_state.user['Telefone'], 
                    "User_Vinculo": st.session_state.user['Usuario'],
                    "Foto": url_f
                }])
                conn.update(worksheet=ABA_ADOCAO, data=pd.concat([ler_planilha(ABA_ADOCAO), novo], ignore_index=True))
                modal_sucesso("Anúncio publicado!", 'adocao_mural')

# ==========================================
# ⚙️ PÁGINA: MEUS PETS (GESTÃO UNIFICADA)
# ==========================================
elif st.session_state.pagina == 'meus_pets':
    st.header("⚙️ Gerenciar Meus Pets")
    
    # SEÇÃO 1: PERDIDOS
    st.subheader("📍 Meus Pets Perdidos")
    df_p = ler_planilha(ABA_PETS)
    meus_p = df_p[(df_p['User_Vinculo'] == st.session_state.user['Usuario']) & (df_p['Status'] == 'Perdido')]
    if meus_p.empty: st.write("Nenhum pet perdido cadastrado.")
    for idx, pet in meus_p.iterrows():
        with st.container(border=True):
            st.write(f"🐾 {pet['Nome_Pet']}")
            if st.button(f"🎉 Encontrei o(a) {pet['Nome_Pet']}!", key=f"enc_{idx}"):
                df_p.at[idx, 'Status'] = 'Encontrado'
                conn.update(worksheet=ABA_PETS, data=df_p)
                modal_sucesso("Parabéns!", 'meus_pets')

    # SEÇÃO 2: ADOÇÃO
    st.subheader("🎁 Meus Anúncios de Adoção")
    df_ad = ler_planilha(ABA_ADOCAO)
    meus_ad = df_ad[df_ad['User_Vinculo'] == st.session_state.user['Usuario']]
    if meus_ad.empty: st.write("Você não tem pets para adoção cadastrados.")
    for idx, pet in meus_ad.iterrows():
        with st.container(border=True):
            st.write(f"🏠 {pet['Nome_Pet']}")
            if st.button(f"✅ Já foi Adotado / Remover Anúncio", key=f"rem_{idx}"):
                df_ad = df_ad.drop(idx)
                conn.update(worksheet=ABA_ADOCAO, data=df_ad)
                modal_sucesso("Anúncio removido!", 'meus_pets')

# --- OUTRAS PÁGINAS MANTIDAS ---
elif st.session_state.pagina == 'hall_fama':
    st.header("🏆 Hall da Fama")
    st.write("Histórias de reencontros felizes em Santa Cruz do Sul!")

elif st.session_state.pagina == 'cadastro_user':
    st.header("📝 Criar Conta")
    with st.form("c"):
        n, u, p, t = st.text_input("Nome"), st.text_input("Usuário"), st.text_input("Senha", type="password"), st.text_input("WhatsApp")
        if st.form_submit_button("CADASTRAR"):
            conn.update(worksheet=ABA_USUARIOS, data=pd.concat([ler_planilha(ABA_USUARIOS), pd.DataFrame([{"Usuario":u, "Senha":p, "Nome":n, "Telefone":t}])], ignore_index=True))
            modal_sucesso("Conta criada!")
