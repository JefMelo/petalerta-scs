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

# 1. Configuração Inicial (Primeira linha obrigatória)
st.set_page_config(page_title="PetAlerta SCS", page_icon="🐾", layout="centered")

# --- INICIALIZAÇÃO DE ESTADOS ---
if 'pagina' not in st.session_state: st.session_state.pagina = 'home'
if 'logado' not in st.session_state: st.session_state.logado = False
if 'user' not in st.session_state: st.session_state.user = {}
if 'temp_lat' not in st.session_state: st.session_state.temp_lat = None
if 'temp_lng' not in st.session_state: st.session_state.temp_lng = None
if 'temp_end' not in st.session_state: st.session_state.temp_end = ""
# --- NOVO ESTADO PARA O ZOOM ---
if 'foto_ampliada' not in st.session_state: st.session_state.foto_ampliada = None

SCS_COORDS = [-29.7182, -52.4306]
geolocator = Nominatim(user_agent="petalerta_scs_final_v5_prod")
conn = st.connection("gsheets", type=GSheetsConnection)

# --- INJEÇÃO DE CSS CUSTOMIZADO (PARA O LIGHTBOX) ---
st.markdown("""
<style>
/* Estilo para o fundo escuro do Lightbox */
.lightbox-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.85);
    z-index: 999999; /* Garante que fique por cima de tudo */
    display: flex;
    justify-content: center;
    align-items: center;
    cursor: pointer;
}

/* Estilo para a imagem ampliada */
.lightbox-image {
    max-width: 90%;
    max-height: 90%;
    border-radius: 10px;
    box-shadow: 0 0 20px rgba(255, 255, 255, 0.2);
    border: 3px solid white;
}

/* Botão para transformar imagem em clicável (invisível) */
.stButton>button.img-click-btn {
    background: none;
    border: none;
    padding: 0;
    width: 100%;
    height: 100%;
    position: absolute;
    top: 0;
    left: 0;
    opacity: 0; /* Invisível */
    z-index: 10;
}

/* Container da imagem no mural */
.mural-img-container {
    position: relative;
    cursor: pointer;
}
</style>
""", unsafe_allow_html=True)

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
        img.thumbnail((800, 800)) # Aumentamos o tamanho para o zoom ficar bom
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=70, optimize=True)
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

# --- LÓGICA DE EXIBIÇÃO DO ZOOM (LIGHTBOX) ---
# Se houver uma foto para ampliar, renderizamos o HTML do Lightbox
if st.session_state.foto_ampliada:
    # Criamos o HTML da imagem grande
    img_html = f'<img src="data:image/jpeg;base64,{st.session_state.foto_ampliada}" class="lightbox-image">'
    # Renderizamos o overlay clicável
    st.markdown(f'<div class="lightbox-overlay" id="zoom_overlay">{img_html}</div>', unsafe_allow_html=True)
    
    # Criamos um botão invisível do Streamlit que ocupa a tela toda para fechar
    if st.button("Fechar Zoom", key="close_zoom_btn", help="Clique em qualquer lugar para fechar"):
        st.session_state.foto_ampliada = None
        st.rerun()

# --- SIDEBAR: ÁREA DE MEMBROS ---
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
        st.success(f"Olá, {str(st.session_state.user['Nome']).split()[0]}!")
        if st.button("📍 Meus Pets"): ir_para('meus_pets')
        if st.button("🏠 Início"): ir_para('home')
        if st.button("🚪 Sair", width='stretch'):
            st.session_state.logado = False
            st.session_state.user = {}
            ir_para('home')

# --- TELA 1: HOME (MAPA E MURAL) ---
if st.session_state.pagina == 'home':
    st.title("🐾 PetAlerta Santa Cruz do Sul")
    df = buscar_dados(0)
    
    # --- MAPA ---
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
                
                # Banner HTML do Mapa
                img_data = pet['Foto']
                if img_data:
                    # Foto no mapa (pequena, proporcional)
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
    else: st.info("💡 Faça login na barra lateral para registrar um pet.")

    # --- MURAL COM WHATSAPP PROTEGIDO E ZOOM ---
    st.subheader("🔍 Mural de Desaparecidos")
    if not df.empty:
        perdidos = df[df['Status'] == 'Perdido']
        for _, pet in perdidos.iterrows():
            with st.container(border=True):
                col1, col2 = st.columns([1, 1.5])
                
                with col1:
                    if pet['Foto']:
                        # --- NOVA LÓGICA DE FOTO CLICÁVEL (TRUQUE CSS) ---
                        # 1. Renderizamos a imagem normal
                        st.image(f"data:image/jpeg;base64,{pet['Foto']}", use_container_width=True)
                        # 2. Criamos um botão transparente em cima dela com uma classe CSS customizada
                        if st.button("🔍 Ver Grande", key=f"zoom_{pet['ID']}", help="Clique para ampliar", class_name="img-click-btn"):
                            # Ao clicar, salvamos a foto no estado e damos rerun para ativar o lightbox no topo
                            st.session_state.foto_ampliada = pet['Foto']
                            st.rerun()
                    else:
                        st.warning("Sem foto")

                with col2:
                    st.subheader(pet['Nome_Pet'])
                    st.write(f"**Espécie:** {pet['Especie']} | **Cor:** {pet['Cor']}")
                    st.write(f"📍 {pet['Local_Desaparecimento']}")
                    st.write(f"📝 {pet['Caracteristicas']}")
                    
                    if st.session_state.logado:
                        tel_limpo = "".join(c for c in str(pet['Tel_Tutor']) if c.isdigit())
                        if not tel_limpo.startswith('55'): tel_limpo = '55' + tel_limpo
                        link_wa = f"https://wa.me/{tel_limpo}?text=Olá%20vi%20o%20alerta%20do%20{pet['Nome_Pet']}%20no%20PetAlerta!"
                        
                        nome_cru = pet['Nome_Tutor'].strip()
                        nome_exibicao = nome_cru.split()[0] if nome_cru else "Tutor"
                        
                        st.link_button(f"💬 WhatsApp de {nome_exibicao}", link_wa, type="primary", use_container_width=True)
                    else:
                        st.warning("🔒 Logue para ver o contato")

# --- TELA 2: REGISTRO ---
elif st.session_state.pagina == 'perdi_pet':
    st.button("⬅️ Voltar", on_click=lambda: ir_para('home'))
    st.header("🚨 Registrar Animal")
    
    m_s = folium.Map(location=SCS_COORDS, zoom_start=15)
    if st.session_state.temp_lat:
        folium.Marker([st.session_state.temp_lat, st.session_state.temp_lng], icon=folium.Icon(color='red', icon='crosshairs', prefix='fa')).add_to(m_s)
    
    map_res = st_folium(m_s, width='stretch', height=300, key="reg_map")
    if map_res and map_res.get("last_clicked"):
        lat, lng = map_res["last_clicked"]["lat"], map_res["last_clicked"]["lng"]
        if lat != st.session_state.temp_lat:
            st.session_state.temp_lat, st.session_state.temp_lng = lat, lng
            try:
                loc = geolocator.reverse(f"{lat}, {lng}", timeout=10)
                st.session_state.temp_end = loc.address.split(', Santa Cruz')[0] if loc else "Marcado"
            except: st.session_state.temp_end = "Marcado"
            st.rerun()

    with st.form("form_pet"):
        st.write(f"📍 **Localização:** {st.session_state.temp_end}")
        c1, c2 = st.columns(2)
        with c1:
            nome_p = st.text_input("Nome do PET*")
            especie = st.selectbox("Espécie*", ["Cão", "Gato", "Pássaro", "Outro"])
            raca = st.text_input("Raça")
        with c2:
            cor = st.text_input("Cor")
            carac = st.text_area("Características")
        foto = st.file_uploader("Foto")

        if st.form_submit_button("PUBLICAR ALERTA", width='stretch'):
            if nome_p and st.session_state.temp_lat:
                foto_s = processar_foto(foto) # O processamento agora aceita fotos maiores
                df_b = buscar_dados(0)
                u = st.session_state.user
                novo = pd.DataFrame([{
                    "ID": str(int(datetime.now().timestamp())), "Data": datetime.now().strftime("%d/%m/%Y"),
                    "Status": "Perdido", "Especie": especie, "Nome_Pet": nome_p, "Raca": raca, "Cor": cor,
                    "Caracteristicas": carac, "Local_Desaparecimento": st.session_state.temp_end,
                    "Lat": "{:.6f}".format(st.session_state.temp_lat), "Lng": "{:.6f}".format(st.session_state.temp_lng),
                    "Foto": foto_s, "Nome_Tutor": u['Nome'], "Tel_Tutor": u['Telefone'],
                    "User_Vinculo": u['Usuario']
                }])
                conn.update(worksheet=0, data=pd.concat([df_b, novo], ignore_index=True))
                st.session_state.temp_lat = None
                st.success("Publicado!")
                ir_para('home')

# --- TELA 3: CADASTRO ---
elif st.session_state.pagina == 'cadastro_user':
    st.title("📝 Criar Conta")
    with st.form("f_cad"):
        n = st.text_input("Nome Completo*")
        tl = st.text_input("WhatsApp (DDD+Número)*")
        em = st.text_input("E-mail*")
        us = st.text_input("Usuário (Login)*")
        pw = st.text_input("Senha*", type="password")
        if st.form_submit_button("CADASTRAR"):
            if n and tl and em and us and pw:
                df_u = conn.read(worksheet="Usuarios", ttl=0)
                novo_u = pd.DataFrame([{"Nome":n, "Telefone":tl, "Email":em, "Usuario":us, "Senha":pw, "Nivel":"Membro"}])
                conn.update(worksheet="Usuarios", data=pd.concat([df_u, novo_u], ignore_index=True))
                st.success("Conta criada! Logue na lateral.")
                ir_para('home')
    st.button("Voltar", on_click=lambda: ir_para('home'))

# --- TELA 4: MEUS PETS ---
elif st.session_state.pagina == 'meus_pets':
    st.header("📋 Meus Alertas")
    df_all = buscar_dados(0)
    meus = df_all[df_all['User_Vinculo'] == st.session_state.user['Usuario']]
    if meus.empty: st.write("Você não tem pets cadastrados.")
    else:
        for _, p in meus.iterrows():
            with st.container(border=True):
                st.subheader(p['Nome_Pet'])
                if st.button(f"Marcar como Encontrado", key=f"b_{p['ID']}"):
                    df_all.loc[df_all['ID'] == p['ID'], 'Status'] = 'Encontrado'
                    conn.update(worksheet=0, data=df_all)
                    st.rerun()
    st.button("Voltar", on_click=lambda: ir_para('home'))
