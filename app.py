import streamlit as st
from streamlit_gsheets import GSheetsConnection
import pandas as pd
from datetime import datetime
import base64
from PIL import Image
import io
import folium
from streamlit_folium import st_folium
from geopy.geocoders import Nominatim

# 1. Configuração Inicial
st.set_page_config(page_title="PetAlerta SCS", page_icon="🐾", layout="centered")

# --- ESTADOS DE SESSÃO ---
if 'pagina' not in st.session_state: st.session_state.pagina = 'home'
if 'logado' not in st.session_state: st.session_state.logado = False
if 'user' not in st.session_state: st.session_state.user = {}
if 'temp_lat' not in st.session_state: st.session_state.temp_lat = None
if 'temp_lng' not in st.session_state: st.session_state.temp_lng = None
if 'temp_end' not in st.session_state: st.session_state.temp_end = ""

SCS_COORDS = [-29.7182, -52.4306]
geolocator = Nominatim(user_agent="petalerta_scs_final_v4")
conn = st.connection("gsheets", type=GSheetsConnection)

# --- FUNÇÕES DE SUPORTE ---

def verificar_login(user_in, pwd_in):
    try:
        df_u = conn.read(worksheet="Usuarios", ttl=0)
        if df_u is None or df_u.empty: return None
        u_clean = str(user_in).strip().lower()
        p_clean = str(pwd_in).strip()
        for _, row in df_u.iterrows():
            db_user = str(row['Usuario']).strip().lower()
            db_pass = str(row['Senha']).strip()
            if db_pass.endswith('.0'): db_pass = db_pass[:-2]
            if u_clean == db_user and p_clean == db_pass:
                return row.to_dict()
        return None
    except: return None

def processar_foto(arquivo):
    if arquivo:
        img = Image.open(arquivo)
        if img.mode in ("RGBA", "P"): img = img.convert("RGB")
        img.thumbnail((300, 300)) 
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=50, optimize=True)
        return base64.b64encode(buf.getvalue()).decode()
    return ""

def buscar_dados(aba_index=0):
    try:
        df = conn.read(worksheet=aba_index, ttl=0)
        if df is None or df.empty: return pd.DataFrame()
        df = df.astype(str)
        return df.replace('nan', '')
    except: return pd.DataFrame()

def ir_para(pagina):
    st.session_state.pagina = pagina
    st.rerun()

# --- SIDEBAR ---
with st.sidebar:
    st.header("👤 Área de Membros")
    if not st.session_state.logado:
        u_login = st.text_input("Usuário", key="login_user")
        p_login = st.text_input("Senha", type="password", key="login_pass")
        if st.button("Entrar", width='stretch'):
            dados = verificar_login(u_login, p_login)
            if dados:
                st.session_state.logado, st.session_state.user = True, dados
                st.rerun()
            else: st.error("Usuário ou senha incorretos.")
        if st.button("Criar Conta", width='stretch'): ir_para('cadastro_user')
    else:
        nome_nav = str(st.session_state.user.get('Nome', 'Usuário')).split()[0]
        st.success(f"Olá, {nome_nav}!")
        if st.button("📍 Meus Pets"): ir_para('meus_pets')
        if st.button("🏠 Início"): ir_para('home')
        if st.button("🚪 Sair", width='stretch'):
            st.session_state.logado = False
            st.session_state.user = {}
            ir_para('home')

# --- TELA 1: HOME ---
if st.session_state.pagina == 'home':
    st.title("🐾 PetAlerta Santa Cruz do Sul")
    df = buscar_dados(0)
    
    m_h = folium.Map(location=SCS_COORDS, zoom_start=14)
    if not df.empty:
        perdidos = df[df['Status'].str.contains('Perdido', case=False, na=False)]
        for _, pet in perdidos.iterrows():
            try:
                raw_lat = "".join(c for c in str(pet['Lat']) if c in "-.0123456789")
                raw_lng = "".join(c for c in str(pet['Lng']) if c in "-.0123456789")
                if "." not in raw_lat and len(raw_lat) > 5: raw_lat = raw_lat[:3] + "." + raw_lat[3:]
                if "." not in raw_lng and len(raw_lng) > 5: raw_lng = raw_lng[:3] + "." + raw_lng[3:]
                
                esp = str(pet['Especie']).lower()
                if 'gato' in esp: icone, cor = 'cat', 'blue'
                elif 'cão' in esp or 'cao' in esp: icone, cor = 'dog', 'orange'
                else: icone, cor = 'paw', 'gray'

                # Banner HTML do Mapa (Correção das aspas)
                img_data = pet['Foto']
                if img_data:
                    img_tag = f'<img src="data:image/jpeg;base64,{img_data}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 5px; float: left; margin-right: 10px;">'
                else:
                    img_tag = '<div style="width: 60px; height: 60px; background-color: #eee; border-radius: 5px; float: left; margin-right: 10px;"></div>'

                html_popup = folium.Html(f'''
                    <div style="width: 200px; font-family: sans-serif;">
                        {img_tag}
                        <b style="font-size: 14px;">{pet['Nome_Pet']}</b><br>
                        <small style="color: #666;">{pet['Especie']}</small>
                    </div>
                ''', script=True)
                
                folium.Marker([float(raw_lat), float(raw_lng)], popup=folium.Popup(html_popup), icon=folium.Icon(color=cor, icon=icone, prefix='fa')).add_to(m_h)
            except: continue
    
    st_folium(m_h, width='stretch', height=400, key="home_map")
    if st.session_state.logado:
        if st.button("🚨 REGISTRAR PET PERDIDO", width='stretch'): ir_para('perdi_pet')

    st.subheader("🔍 Mural")
    if not df.empty:
        perdidos = df[df['Status'] == 'Perdido']
        for _, pet in perdidos.iterrows():
            with st.container(border=True):
                c1, c2 = st.columns([1, 1.5])
                with c1:
                    if pet['Foto']: st.image(f"data:image/jpeg;base64,{pet['Foto']}", use_container_width=True)
                with c2:
                    st.subheader(pet['Nome_Pet'])
                    st.write(f"📍 {pet['Local_Desaparecimento']}")
                    if st.session_state.logado:
                        tel = "".join(c for c in str(pet['Tel_Tutor']) if c.isdigit())
                        if not tel.startswith('55'): tel = '55' + tel
                        link = f"https://wa.me/{tel}?text=Vi%20o%20alerta%20do%20{pet['Nome_Pet']}"
                        nome_t = str(pet['Nome_Tutor']).strip().split()[0] if pet['Nome_Tutor'] else "Tutor"
                        st.link_button(f"💬 WhatsApp de {nome_t}", link, type="primary")

# --- TELA 2: REGISTRO ---
elif st.session_state.pagina == 'perdi_pet':
    st.button("⬅️ Voltar", on_click=lambda: ir_para('home'))
    st.header("🚨 Registrar Animal")
    m_s = folium.Map(location=SCS_COORDS, zoom_start=15)
    if st.session_state.temp_lat:
        folium.Marker([st.session_state.temp_lat, st.session_state.temp_lng], icon=folium.Icon(color='red')).add_to(m_s)
    res = st_folium(m_s, width='stretch', height=300, key="reg_map")
    if res and res.get("last_clicked"):
        st.session_state.temp_lat, st.session_state.temp_lng = res["last_clicked"]["lat"], res["last_clicked"]["lng"]
        try:
            l = geolocator.reverse(f"{st.session_state.temp_lat}, {st.session_state.temp_lng}")
            st.session_state.temp_end = l.address.split(', Santa Cruz')[0]
        except: st.session_state.temp_end = "Marcado"
        st.rerun()

    with st.form("f_pet"):
        n_p = st.text_input("Nome do PET*")
        esp = st.selectbox("Espécie*", ["Cão", "Gato", "Pássaro", "Outro"])
        rac = st.text_input("Raça")
        cor = st.text_input("Cor")
        car = st.text_area("Características")
        fot = st.file_uploader("Foto")
        if st.form_submit_button("PUBLICAR"):
            if n_p and st.session_state.temp_lat:
                fs = processar_foto(fot)
                df_b = buscar_dados(0)
                u = st.session_state.user
                novo = pd.DataFrame([{
                    "ID": str(int(datetime.now().timestamp())), "Data": datetime.now().strftime("%d/%m/%Y"),
                    "Status": "Perdido", "Especie": esp, "Nome_Pet": n_p, "Raca": rac, "Cor": cor,
                    "Caracteristicas": car, "Local_Desaparecimento": st.session_state.temp_end,
                    "Lat": "{:.6f}".format(st.session_state.temp_lat), "Lng": "{:.6f}".format(st.session_state.temp_lng),
                    "Foto": fs, "Nome_Tutor": u['Nome'], "Tel_Tutor": u['Telefone'], "User_Vinculo": u['Usuario']
                }])
                conn.update(worksheet=0, data=pd.concat([df_b, novo], ignore_index=True))
                st.session_state.temp_lat = None
                ir_para('home')

# --- TELA 3: CADASTRO ---
elif st.session_state.pagina == 'cadastro_user':
    st.title("📝 Criar Conta")
    with st.form("f_cad"):
        n = st.text_input("Nome Completo*")
        tl = st.text_input("WhatsApp*")
        em = st.text_input("E-mail*")
        us = st.text_input("Usuário*")
        pw = st.text_input("Senha*", type="password")
        if st.form_submit_button("CADASTRAR"):
            if n and tl and em and us and pw:
                df_u = conn.read(worksheet="Usuarios", ttl=0)
                novo_u = pd.DataFrame([{"Nome":n, "Telefone":tl, "Email":em, "Usuario":us, "Senha":pw, "Nivel":"Membro"}])
                conn.update(worksheet="Usuarios", data=pd.concat([df_u, novo_u], ignore_index=True))
                ir_para('home')

# --- TELA 4: MEUS PETS ---
elif st.session_state.pagina == 'meus_pets':
    st.header("📋 Meus Alertas")
    df_all = buscar_dados(0)
    meus = df_all[df_all['User_Vinculo'] == st.session_state.user['Usuario']]
    for _, p in meus.iterrows():
        with st.container(border=True):
            st.subheader(p['Nome_Pet'])
            if st.button(f"Marcar como Encontrado", key=f"b_{p['ID']}"):
                df_all.loc[df_all['ID'] == p['ID'], 'Status'] = 'Encontrado'
                conn.update(worksheet=0, data=df_all)
                st.rerun()
    st.button("Voltar", on_click=lambda: ir_para('home'))
